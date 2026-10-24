"""
HackSphere 3.0: Telemetry Schema Validation

Validates CSV and JSON payloads against the inference contract:
- Exactly 4 required columns: 'timestamp', 'ambient_temp_c', 'humidity_pct', 'solar_irradiance_wm2'
- Timestamp formatting and parseability
- Numeric data types and sensible physical ranges
- Support for arbitrary window sizes, with dedicated check for 24-hour forecasts
"""

import pandas as pd
import numpy as np
from typing import List, Dict, Any, Tuple


REQUIRED_COLUMNS = ["timestamp", "ambient_temp_c", "humidity_pct", "solar_irradiance_wm2"]

# Physical boundary sanity checks
NUMERIC_BOUNDS = {
    "ambient_temp_c": (-50.0, 70.0),       # Celsius
    "humidity_pct": (0.0, 100.0),          # Percentage
    "solar_irradiance_wm2": (0.0, 1500.0)  # W/m^2
}


class ValidationError(Exception):
    def __init__(self, message: str, errors: List[str] = None):
        super().__init__(message)
        self.message = message
        self.errors = errors or [message]


def validate_telemetry_dataframe(df: pd.DataFrame, expect_24h: bool = False) -> Tuple[pd.DataFrame, List[str]]:
    """
    Validates a pandas DataFrame containing telemetry rows.

    Args:
        df: Input DataFrame.
        expect_24h: If True, warns or validates that length is exactly 24 rows.

    Returns:
        Tuple[pd.DataFrame, List[str]]: (clean_df, warnings)

    Raises:
        ValidationError: If schema or values are invalid.
    """
    errors = []
    warnings = []

    if df.empty:
        raise ValidationError("Input dataset is empty. At least 1 row is required.")

    # 1. Column presence check
    missing_cols = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing_cols:
        raise ValidationError(
            f"Missing required columns: {', '.join(missing_cols)}. "
            f"Expected columns: {', '.join(REQUIRED_COLUMNS)}",
            errors=[f"Missing column '{c}'" for c in missing_cols]
        )

    # Filter to only required columns
    clean_df = df[REQUIRED_COLUMNS].copy()

    # 2. Row count check
    if expect_24h and len(clean_df) != 24:
        warnings.append(f"Expected 24 rows for a full 24-hour forecast window, but received {len(clean_df)} rows.")

    # 3. Timestamp validation
    try:
        parsed_ts = pd.to_datetime(clean_df["timestamp"], errors="coerce")
        null_ts_indices = parsed_ts[parsed_ts.isna()].index.tolist()
        if null_ts_indices:
            errors.append(f"Invalid timestamp format at row(s): {null_ts_indices[:10]}. Expected format 'YYYY-MM-DD HH:MM:SS'.")
        else:
            clean_df["timestamp"] = parsed_ts.dt.strftime("%Y-%m-%d %H:%M:%S")
    except Exception as e:
        errors.append(f"Error parsing timestamps: {str(e)}")

    # 4. Numeric column validations
    for col, (min_val, max_val) in NUMERIC_BOUNDS.items():
        # Coerce to numeric
        converted = pd.to_numeric(clean_df[col], errors="coerce")
        null_indices = converted[converted.isna()].index.tolist()
        if null_indices:
            errors.append(f"Column '{col}' contains non-numeric or missing values at row(s): {null_indices[:10]}")
            continue

        clean_df[col] = converted

        # Physical range sanity check
        out_of_bounds = clean_df[(clean_df[col] < min_val) | (clean_df[col] > max_val)]
        if not out_of_bounds.empty:
            bad_indices = out_of_bounds.index.tolist()
            warnings.append(
                f"Column '{col}' has values outside typical realistic bounds [{min_val}, {max_val}] at row(s) {bad_indices[:5]}."
            )

    if errors:
        raise ValidationError(f"Telemetry data validation failed: {'; '.join(errors)}", errors=errors)

    return clean_df, warnings
