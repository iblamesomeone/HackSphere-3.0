import os
import json
import io
import unittest
import pandas as pd
from backend.app import app
from backend.quickml_client import QuickMLClient, QuickMLError


class TestBackendIntegration(unittest.TestCase):

    def setUp(self):
        self.client = app.test_client()
        self.sample_rows = [
            {
                "timestamp": f"2024-01-01 {h:02d}:00:00",
                "ambient_temp_c": 22.0 + (h % 5),
                "humidity_pct": 55.0,
                "solar_irradiance_wm2": 300.0 if 8 <= h <= 17 else 0.0
            }
            for h in range(24)
        ]

    def test_health_endpoint(self):
        resp = self.client.get("/api/health")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data["status"], "healthy")
        self.assertIn("quickml_configured", data)

    def test_sample_endpoint(self):
        resp = self.client.get("/api/sample")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data["count"], 24)
        self.assertEqual(len(data["data"]), 24)

    def test_manual_forecast_successful_with_labelled_model(self):
        # Enable dev baseline explicitly in test environment
        os.environ["ALLOW_DEV_LOCAL_BASELINE"] = "1"
        os.environ["QUICKML_ENDPOINT_URL"] = ""

        resp = self.client.post(
            "/api/forecast/manual",
            json={"data": self.sample_rows, "initial_soc_pct": 80.0}
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertTrue(data["success"])
        self.assertEqual(data["forecast_hours"], 24)
        self.assertIn("model_source", data)
        self.assertTrue(data["is_simulated_model"])  # Because QuickML is unset
        self.assertIn("dispatch_schedule", data)
        self.assertEqual(len(data["dispatch_schedule"]), 24)
        
        # Verify simulated tags are present
        first_row = data["dispatch_schedule"][0]
        self.assertIn("battery_soc_pct_simulated", first_row)
        self.assertEqual(first_row["simulated_tag"], "Simulated Output")

    def test_csv_upload_successful(self):
        os.environ["ALLOW_DEV_LOCAL_BASELINE"] = "1"
        df = pd.DataFrame(self.sample_rows)
        csv_buffer = io.BytesIO()
        df.to_csv(csv_buffer, index=False)
        csv_buffer.seek(0)

        resp = self.client.post(
            "/api/forecast/csv",
            data={"file": (csv_buffer, "test_telemetry.csv"), "initial_soc_pct": "75.0"},
            content_type="multipart/form-data"
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertTrue(data["success"])
        self.assertEqual(data["forecast_hours"], 24)

    def test_invalid_schema_missing_column(self):
        bad_rows = [{"timestamp": "2024-01-01 10:00:00", "ambient_temp_c": 25.0}]  # missing humidity & solar
        resp = self.client.post("/api/forecast/manual", json={"data": bad_rows})
        self.assertEqual(resp.status_code, 422)
        data = resp.get_json()
        self.assertIn("Missing required columns", data["error"])

    def test_invalid_timestamp_format(self):
        bad_rows = [
            {
                "timestamp": "invalid_date_format",
                "ambient_temp_c": 25.0,
                "humidity_pct": 50.0,
                "solar_irradiance_wm2": 100.0
            }
        ]
        resp = self.client.post("/api/forecast/manual", json={"data": bad_rows})
        self.assertEqual(resp.status_code, 422)
        data = resp.get_json()
        self.assertIn("Invalid timestamp", data["error"])

    def test_quickml_unconfigured_error_when_dev_baseline_disabled(self):
        # Disable dev baseline to test strict production mode
        os.environ["ALLOW_DEV_LOCAL_BASELINE"] = "0"
        os.environ["QUICKML_ENDPOINT_URL"] = ""

        # Re-initialize client in app
        from backend import app as app_module
        app_module.quickml_client = QuickMLClient()

        resp = self.client.post("/api/forecast/manual", json={"data": self.sample_rows})
        self.assertEqual(resp.status_code, 503)
        data = resp.get_json()
        self.assertIn("QuickML endpoint is not configured", data["error"])

    def test_serve_frontend_static_assets(self):
        # Index HTML
        resp = self.client.get("/")
        self.assertEqual(resp.status_code, 200)
        self.assertIn(b"HOUSTATLANTAVEGAS", resp.data)
        self.assertIn(b"forecastChart", resp.data)

        # CSS Stylesheet
        resp_css = self.client.get("/styles.css")
        self.assertEqual(resp_css.status_code, 200)
        self.assertIn(b"--bg-ivory", resp_css.data)

        # JavaScript Engine
        resp_js = self.client.get("/app.js")
        self.assertEqual(resp_js.status_code, 200)
        self.assertIn(b"executeForecastRequest", resp_js.data)


if __name__ == "__main__":
    unittest.main()
