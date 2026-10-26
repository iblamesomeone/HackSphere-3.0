"""
HackSphere 3.0: Core Ingestion, Forecasting & Dispatch API Server

Exposes REST endpoints for:
- POST /api/forecast/csv: Multipart CSV upload with validation
- POST /api/forecast/manual: JSON array of 24-hour weather rows
- GET /api/health: Health check, QuickML status and model configuration state
- GET /api/sample: Serves sample 24-hour input rows for instant testing
"""

import os
import io
import pandas as pd
from flask import Flask, request, jsonify
from flask_cors import CORS

from backend.validator import validate_telemetry_dataframe, ValidationError
from backend.quickml_client import QuickMLClient, QuickMLError
from backend.transition_controller import simulate_battery_dispatch

frontend_folder = os.path.join(os.path.dirname(__file__), "..", "frontend")
app = Flask(__name__, static_folder=frontend_folder, static_url_path="")
CORS(app)

quickml_client = QuickMLClient()


@app.route("/", methods=["GET"])
def index():
    """Serves the frontend single-page dashboard."""
    return app.send_static_file("index.html")


@app.route("/api/health", methods=["GET"])
def health_check():
    """Returns system status, active configuration and model provider details."""
    is_prod_ready = quickml_client.is_configured()
    allow_dev_baseline = quickml_client.allows_baseline
    return jsonify({
        "status": "healthy",
        "service": "HackSphere 3.0 Energy Engine",
        "quickml_configured": is_prod_ready,
        "quickml_endpoint": quickml_client.endpoint_url if is_prod_ready else "Not Configured",
        "allow_dev_baseline": allow_dev_baseline,
        "mode": "production" if is_prod_ready else ("development_fallback" if allow_dev_baseline else "unconfigured_error")
    }), 200


@app.route("/api/sample", methods=["GET"])
def get_sample_telemetry():
    """Returns 24 hours of sample input telemetry from sample_test_input.csv."""
    candidates = [
        os.path.join(os.path.dirname(__file__), "..", "HackSphere_Starter_Kit", "sample_test_input.csv"),
        os.path.join(os.path.dirname(__file__), "HackSphere_Starter_Kit", "sample_test_input.csv"),
        os.path.join(os.getcwd(), "HackSphere_Starter_Kit", "sample_test_input.csv"),
        os.path.join(os.getcwd(), "sample_test_input.csv"),
    ]
    sample_path = None
    for p in candidates:
        if os.path.exists(p):
            sample_path = p
            break

    if not sample_path:
        return jsonify({"error": "Sample dataset not found on server."}), 404

    df = pd.read_csv(sample_path)
    sample_24h = df.head(24).to_dict(orient="records")
    return jsonify({
        "count": len(sample_24h),
        "data": sample_24h
    }), 200


def _process_forecast_pipeline(df: pd.DataFrame, initial_soc: float = 85.0):
    """Common pipeline: Validate -> Predict -> Transition & Battery Control."""
    # 1. Validation
    clean_df, warnings = validate_telemetry_dataframe(df)

    # 2. Prediction
    preds, model_source = quickml_client.predict(clean_df)

    # 3. Augment with predicted target demand
    clean_df["target_demand_kw"] = preds
    records = clean_df.to_dict(orient="records")

    # 4. Smart Grid Transition Controller & Battery Dispatch
    dispatch_results = simulate_battery_dispatch(records, initial_soc_pct=initial_soc)

    # Summary metrics
    overload_count = sum(1 for r in dispatch_results if r["critical_overload_alert"])
    renewable_hours = sum(1 for r in dispatch_results if r["grid_mode"] == "Renewable Storage")
    main_grid_hours = sum(1 for r in dispatch_results if r["grid_mode"] == "Main Grid")
    peak_demand = max(r["demand_kw"] for r in dispatch_results) if dispatch_results else 0.0
    avg_demand = round(sum(r["demand_kw"] for r in dispatch_results) / len(dispatch_results), 2) if dispatch_results else 0.0

    return {
        "success": True,
        "model_source": model_source,
        "is_simulated_model": "Local Baseline" in model_source,
        "warnings": warnings,
        "forecast_hours": len(dispatch_results),
        "summary": {
            "peak_demand_kw": peak_demand,
            "avg_demand_kw": avg_demand,
            "renewable_storage_hours": renewable_hours,
            "main_grid_hours": main_grid_hours,
            "critical_overload_events": overload_count
        },
        "dispatch_schedule": dispatch_results
    }


@app.route("/api/forecast/csv", methods=["POST"])
def forecast_csv():
    """Upload a CSV file containing weather telemetry to run 24h demand forecasting & grid dispatch."""
    if "file" not in request.files:
        return jsonify({"error": "Missing CSV file in multipart request. Key must be 'file'."}), 400

    file = request.files["file"]
    if not file.filename.endswith(".csv"):
        return jsonify({"error": "Uploaded file must be a .csv file."}), 400

    initial_soc = float(request.form.get("initial_soc_pct", 85.0))

    try:
        content = file.read().decode("utf-8")
        df = pd.read_csv(io.StringIO(content))
    except Exception as e:
        return jsonify({"error": f"Failed to parse CSV file: {str(e)}"}), 400

    try:
        result = _process_forecast_pipeline(df, initial_soc=initial_soc)
        return jsonify(result), 200
    except ValidationError as ve:
        return jsonify({"error": ve.message, "details": ve.errors}), 422
    except QuickMLError as qme:
        return jsonify({"error": qme.message, "details": qme.details}), qme.status_code
    except Exception as e:
        return jsonify({"error": f"Internal processing error: {str(e)}"}), 500


@app.route("/api/forecast/manual", methods=["POST"])
def forecast_manual():
    """Accepts JSON payload of weather telemetry rows for 24h forecast & grid dispatch."""
    payload = request.get_json(silent=True)
    if not payload or not isinstance(payload, dict):
        return jsonify({"error": "Request body must be a JSON object."}), 400

    rows = payload.get("data")
    if not rows or not isinstance(rows, list):
        return jsonify({"error": "Payload must include a 'data' array of telemetry rows."}), 400

    initial_soc = float(payload.get("initial_soc_pct", 85.0))

    try:
        df = pd.DataFrame(rows)
    except Exception as e:
        return jsonify({"error": f"Failed to parse rows into table: {str(e)}"}), 400

    try:
        result = _process_forecast_pipeline(df, initial_soc=initial_soc)
        return jsonify(result), 200
    except ValidationError as ve:
        return jsonify({"error": ve.message, "details": ve.errors}), 422
    except QuickMLError as qme:
        return jsonify({"error": qme.message, "details": qme.details}), qme.status_code
    except Exception as e:
        return jsonify({"error": f"Internal processing error: {str(e)}"}), 500


if __name__ == "__main__":
    port = int(os.environ.get("X_ZOHO_CATALYST_LISTEN_PORT", os.environ.get("PORT", 8000)))
    app.run(host="0.0.0.0", port=port, debug=False)

