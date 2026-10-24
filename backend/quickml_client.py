"""
HackSphere 3.0: Production QuickML Client Adapter

Connects directly to the published Zoho Catalyst QuickML REST API:
POST https://api.catalyst.zoho.in/quickml/v1/project/{project_id}/endpoints/predict

Headers:
- X-QUICKML-ENDPOINT-KEY: Deployed endpoint access key
- Authorization: Zoho-oauthtoken {OAuth Access Token} (with automatic CLI refresh)
- CATALYST-ORG: Catalyst organization / ZGID
- Environment: Development / Production

Strict Production Safeguard: Never silently falls back to dummy baselines.
"""

import os
import subprocess
import requests
import numpy as np
import pandas as pd
from typing import List, Dict, Any, Tuple


class QuickMLError(Exception):
    """Custom exception raised when QuickML is unconfigured, unreachable, or fails."""
    def __init__(self, message: str, status_code: int = 502, details: Any = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.details = details


class QuickMLClient:
    def __init__(self):
        # Load local .env if present
        env_file = os.path.join(os.path.dirname(__file__), "..", ".env")
        if os.path.exists(env_file):
            with open(env_file, "r") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        if k.strip() not in os.environ:
                            os.environ[k.strip()] = v.strip()

        self.project_id = os.environ.get("QUICKML_PROJECT_ID", "88718000000013063").strip()
        default_url = f"https://api.catalyst.zoho.in/quickml/v1/project/{self.project_id}/endpoints/predict"
        self.endpoint_url = os.environ.get("QUICKML_ENDPOINT_URL", default_url).strip()
        self.endpoint_key = os.environ.get("QUICKML_ENDPOINT_KEY", "").strip()
        self.org_id = os.environ.get("QUICKML_ORG_ID", "60093044321").strip()
        self.environment = os.environ.get("QUICKML_ENVIRONMENT", "Development").strip()
        self.auth_token = os.environ.get("QUICKML_AUTH_TOKEN", "").strip()
        self.timeout_seconds = float(os.environ.get("QUICKML_TIMEOUT_SECONDS", "30"))

    def is_configured(self) -> bool:
        endpoint = os.environ.get("QUICKML_ENDPOINT_URL", self.endpoint_url).strip()
        return bool(endpoint and endpoint != "YOUR_PUBLISHED_QUICKML_ENDPOINT_URL_HERE")

    @property
    def allows_baseline(self) -> bool:
        return os.environ.get("ALLOW_DEV_LOCAL_BASELINE", "0").lower() in ("1", "true", "yes")

    def _get_active_oauth_token(self) -> str:
        """Retrieves active OAuth access token from environment, or auto-refreshes via Catalyst CLI."""
        token = os.environ.get("QUICKML_AUTH_TOKEN", self.auth_token).strip()
        if token:
            return token

        # Auto-refresh using catalyst cli credential store if available
        script_path = os.path.join(os.path.dirname(__file__), "get_catalyst_token.js")
        if os.path.exists(script_path):
            try:
                proc = subprocess.run(
                    ["node", script_path],
                    capture_output=True,
                    text=True,
                    timeout=5
                )
                if proc.returncode == 0 and proc.stdout.strip():
                    return proc.stdout.strip()
            except Exception:
                pass

        return ""

    def predict(self, input_df: pd.DataFrame) -> Tuple[List[float], str]:
        """
        Generates predictions for each row in input_df using the real Zoho Catalyst QuickML REST endpoint.

        Returns:
            Tuple[List[float], str]: (predictions, source_model_type)
        """
        endpoint = os.environ.get("QUICKML_ENDPOINT_URL", self.endpoint_url).strip()

        if endpoint and endpoint != "YOUR_PUBLISHED_QUICKML_ENDPOINT_URL_HERE":
            oauth_token = self._get_active_oauth_token()

            headers = {
                "Content-Type": "application/json",
                "Environment": self.environment
            }
            if self.endpoint_key:
                headers["X-QUICKML-ENDPOINT-KEY"] = self.endpoint_key
            if self.org_id:
                headers["CATALYST-ORG"] = self.org_id
                headers["catalyst-org"] = self.org_id
            if self.project_id:
                headers["x-ziahub-catalyst-project-id"] = self.project_id
            if oauth_token:
                headers["Authorization"] = f"Zoho-oauthtoken {oauth_token}"

            records = input_df[["timestamp", "ambient_temp_c", "humidity_pct", "solar_irradiance_wm2"]].to_dict(orient="records")

            try:
                batch_size = 200
                all_preds = []

                for i in range(0, len(records), batch_size):
                    batch = records[i:i + batch_size]
                    payload = {"data": batch}

                    response = requests.post(
                        endpoint,
                        json=payload,
                        headers=headers,
                        timeout=self.timeout_seconds
                    )

                    if response.status_code != 200:
                        raise QuickMLError(
                            f"QuickML endpoint returned HTTP {response.status_code}: {response.text[:250]}",
                            status_code=502,
                            details={"endpoint": endpoint, "http_status": response.status_code}
                        )

                    result = response.json()
                    if "result" in result:
                        all_preds.extend([float(p) for p in result["result"]])
                    elif "predictions" in result:
                        all_preds.extend([float(p) for p in result["predictions"]])
                    else:
                        raise QuickMLError(
                            f"QuickML response missing prediction array: {list(result.keys())}",
                            status_code=502,
                            details=result
                        )

                if len(all_preds) != len(input_df):
                    raise QuickMLError(
                        f"QuickML prediction length mismatch: expected {len(input_df)}, got {len(all_preds)}",
                        status_code=502
                    )

                return all_preds, "Zoho Catalyst QuickML (Energy_Demand_Regression_Model)"

            except requests.exceptions.RequestException as e:
                err_msg = f"Failed to connect to QuickML endpoint ({endpoint}): {str(e)}"
                if not self.allows_baseline:
                    raise QuickMLError(err_msg, status_code=504, details=str(e))
                print(f"[WARNING] QuickML connection error: {err_msg}. Using labelled dev baseline.")

        # If not configured and dev baseline is disallowed:
        if not self.allows_baseline:
            raise QuickMLError(
                "QuickML endpoint is not configured or unreachable. Production mode rejects unverified models.",
                status_code=503
            )

        # Development Baseline
        return self._compute_dev_baseline(input_df), "Local Baseline (Dev / Offline Fallback - NOT Published QuickML)"

    def _compute_dev_baseline(self, input_df: pd.DataFrame) -> List[float]:
        hours = pd.to_datetime(input_df["timestamp"]).dt.hour
        base_load = 120.0 + 30.0 * np.sin(2 * np.pi * (hours - 6) / 24)
        cooling_load = np.maximum(0.0, input_df["ambient_temp_c"] - 24.0) * 8.5
        preds = (base_load + cooling_load).values
        return [round(float(p), 2) for p in preds]
