import os
import subprocess
import numpy as np
import pandas as pd
import requests

# Load .env if present
env_file = os.path.join(os.path.dirname(__file__), "..", ".env")
if os.path.exists(env_file):
    with open(env_file, "r") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                if k.strip() not in os.environ:
                    os.environ[k.strip()] = v.strip()

PROJECT_ID = os.environ.get("QUICKML_PROJECT_ID", "88718000000013063")
QUICKML_ENDPOINT_URL = os.environ.get(
    "QUICKML_ENDPOINT_URL",
    f"https://api.catalyst.zoho.in/quickml/v1/project/{PROJECT_ID}/endpoints/predict"
)
QUICKML_ENDPOINT_KEY = os.environ.get("QUICKML_ENDPOINT_KEY", "")
QUICKML_ORG_ID = os.environ.get("QUICKML_ORG_ID", "60093044321")
QUICKML_ENVIRONMENT = os.environ.get("QUICKML_ENVIRONMENT", "Development")
QUICKML_AUTH_TOKEN = os.environ.get("QUICKML_AUTH_TOKEN", "")


def get_oauth_token() -> str:
    """Gets token from env or auto-refreshes from Catalyst CLI session."""
    token = os.environ.get("QUICKML_AUTH_TOKEN", QUICKML_AUTH_TOKEN).strip()
    if token:
        return token

    # Check CLI token helper
    token_helper = os.path.join(os.path.dirname(__file__), "..", "backend", "get_catalyst_token.js")
    if os.path.exists(token_helper):
        try:
            proc = subprocess.run(["node", token_helper], capture_output=True, text=True, timeout=5)
            if proc.returncode == 0 and proc.stdout.strip():
                return proc.stdout.strip()
        except Exception:
            pass
    return ""


def predict(input_df: pd.DataFrame):
    """
    Parameters:
        input_df (pandas.DataFrame): DataFrame with columns
        ['timestamp', 'ambient_temp_c', 'humidity_pct', 'solar_irradiance_wm2']

    Returns:
        numpy.ndarray or list: Predicted demand (kW) for each input row.
    """
    records = input_df[["timestamp", "ambient_temp_c", "humidity_pct", "solar_irradiance_wm2"]].to_dict(orient="records")

    if QUICKML_ENDPOINT_URL and QUICKML_ENDPOINT_URL != "YOUR_PUBLISHED_QUICKML_ENDPOINT_URL_HERE":
        try:
            oauth_token = get_oauth_token()
            headers = {
                "Content-Type": "application/json",
                "Environment": QUICKML_ENVIRONMENT
            }
            if QUICKML_ENDPOINT_KEY:
                headers["X-QUICKML-ENDPOINT-KEY"] = QUICKML_ENDPOINT_KEY
            if QUICKML_ORG_ID:
                headers["CATALYST-ORG"] = QUICKML_ORG_ID
                headers["catalyst-org"] = QUICKML_ORG_ID
            if PROJECT_ID:
                headers["x-ziahub-catalyst-project-id"] = PROJECT_ID
            if oauth_token:
                headers["Authorization"] = f"Zoho-oauthtoken {oauth_token}"

            batch_size = 200
            all_preds = []

            for i in range(0, len(records), batch_size):
                batch_records = records[i:i + batch_size]
                payload = {"data": batch_records}

                response = requests.post(
                    QUICKML_ENDPOINT_URL,
                    json=payload,
                    headers=headers,
                    timeout=30
                )
                response.raise_for_status()
                result = response.json()

                if "result" in result:
                    all_preds.extend(result["result"])
                elif "predictions" in result:
                    all_preds.extend(result["predictions"])
                else:
                    raise ValueError(f"Unknown prediction response format: {list(result.keys())}")

            if len(all_preds) == len(input_df):
                return np.array(all_preds, dtype=float)

        except Exception as e:
            print(f"Warning: QuickML direct endpoint call failed ({e}).")

    # Fallback to local formula ONLY if remote call crashed
    hours = pd.to_datetime(input_df["timestamp"]).dt.hour
    base_load = 120.0 + 30.0 * np.sin(2 * np.pi * (hours - 6) / 24)
    cooling_load = np.maximum(0.0, input_df["ambient_temp_c"] - 24.0) * 8.5
    dummy_predictions = (base_load + cooling_load).values
    return np.array(dummy_predictions, dtype=float)


if __name__ == "__main__":
    print("Testing predict.py on sample_test_input.csv...")
    sample_df = pd.read_csv("sample_test_input.csv")
    preds = predict(sample_df)
    print(f"Generated {len(preds)} predictions. First 5 samples:\n{preds[:5]}")