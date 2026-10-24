"""
HackSphere 3.0: QuickML Client Adapter

Handles HTTP communication with the published Zoho Catalyst QuickML endpoint.
Reads configuration strictly from environment variables.
Provides explicit failure reporting with no silent fallback in production.
"""

import os
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
        self.endpoint_url = os.environ.get("QUICKML_ENDPOINT_URL", "").strip()
        self.auth_token = os.environ.get("QUICKML_AUTH_TOKEN", "").strip()
        self.timeout_seconds = float(os.environ.get("QUICKML_TIMEOUT_SECONDS", "10"))
        # Allow local baseline only if explicitly permitted (defaults to False in strict production)
        self.allow_dev_baseline = os.environ.get("ALLOW_DEV_LOCAL_BASELINE", "0").lower() in ("1", "true", "yes")

    def is_configured(self) -> bool:
        endpoint = os.environ.get("QUICKML_ENDPOINT_URL", self.endpoint_url).strip()
        return bool(endpoint and endpoint != "YOUR_PUBLISHED_QUICKML_ENDPOINT_URL_HERE")

    @property
    def allows_baseline(self) -> bool:
        return os.environ.get("ALLOW_DEV_LOCAL_BASELINE", "0").lower() in ("1", "true", "yes")

    def predict(self, input_df: pd.DataFrame) -> Tuple[List[float], str]:
        """
        Generates predictions for each row in input_df.

        Returns:
            Tuple[List[float], str]: (predictions, source_model_type)
            source_model_type is either:
                - "Zoho Catalyst QuickML (Published Endpoint)"
                - "Local Baseline (Dev / Offline Fallback - NOT Published QuickML)"

        Raises:
            QuickMLError: If the real endpoint is unconfigured or fails (and dev baseline is disabled).
        """
        if self.is_configured():
            headers = {"Content-Type": "application/json"}
            if self.auth_token:
                headers["Authorization"] = f"Bearer {self.auth_token}"

            payload = {"data": input_df.to_dict(orient="records")}

            try:
                response = requests.post(
                    self.endpoint_url,
                    json=payload,
                    headers=headers,
                    timeout=self.timeout_seconds
                )
                if response.status_code != 200:
                    raise QuickMLError(
                        f"QuickML endpoint returned HTTP {response.status_code}: {response.text[:200]}",
                        status_code=502,
                        details={"endpoint": self.endpoint_url, "http_status": response.status_code}
                    )
                
                result = response.json()
                if "predictions" not in result:
                    raise QuickMLError(
                        "QuickML response missing 'predictions' key.",
                        status_code=502,
                        details=result
                    )
                
                preds = [float(p) for p in result["predictions"]]
                if len(preds) != len(input_df):
                    raise QuickMLError(
                        f"QuickML prediction length mismatch: expected {len(input_df)}, got {len(preds)}",
                        status_code=502
                    )

                return preds, "Zoho Catalyst QuickML (Published Endpoint)"

            except requests.exceptions.RequestException as e:
                err_msg = f"Failed to connect to QuickML endpoint ({self.endpoint_url}): {str(e)}"
                if not self.allows_baseline:
                    raise QuickMLError(err_msg, status_code=504, details=str(e))
                # Log warning and fall through to dev baseline ONLY if enabled
                print(f"[WARNING] QuickML connection error: {err_msg}. Using labelled dev baseline.")

        # If not configured:
        if not self.allows_baseline:
            raise QuickMLError(
                "QuickML endpoint is not configured in environment variables (QUICKML_ENDPOINT_URL is unset). "
                "Production mode rejects unverified models. Please set QUICKML_ENDPOINT_URL.",
                status_code=503
            )

        # Explicitly labelled Development Baseline (Starter Kit logic)
        return self._compute_dev_baseline(input_df), "Local Baseline (Dev / Offline Fallback - NOT Published QuickML)"

    def _compute_dev_baseline(self, input_df: pd.DataFrame) -> List[float]:
        """
        Deterministic local baseline derived from Starter Kit predict.py logic.
        Explicitly marked and isolated so it cannot be mistaken for QuickML output.
        """
        hours = pd.to_datetime(input_df["timestamp"]).dt.hour
        base_load = 120.0 + 30.0 * np.sin(2 * np.pi * (hours - 6) / 24)
        cooling_load = np.maximum(0.0, input_df["ambient_temp_c"] - 24.0) * 8.5
        preds = (base_load + cooling_load).values
        return [round(float(p), 2) for p in preds]
