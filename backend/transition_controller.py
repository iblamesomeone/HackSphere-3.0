"""
HackSphere 3.0: Smart Grid Transition Controller & Dispatch Logic

Official Transition Rules (from Section 6 of Problem Statement):
1. Demand > 160 kW OR timestamp hour is between 18:00 and 22:00 inclusive:
   -> Grid Mode: 'Renewable Storage'
2. Otherwise (Demand <= 160 kW AND outside 18:00-22:00):
   -> Grid Mode: 'Main Grid'
3. Demand >= 200 kW:
   -> Trigger Critical Overload Alert (independent of grid mode)
"""

from typing import Dict, Any, List, Optional
import pandas as pd


def evaluate_transition_rule(timestamp_str: str, demand_kw: float) -> Dict[str, Any]:
    """
    Evaluates power dispatch mode and critical overload state for a single hour.
    
    Args:
        timestamp_str: Timestamp in 'YYYY-MM-DD HH:MM:SS' format (or ISO string)
        demand_kw: Forecasted or actual power demand in kW
        
    Returns:
        dict: {
            "timestamp": str,
            "demand_kw": float,
            "hour": int,
            "grid_mode": str ("Renewable Storage" | "Main Grid"),
            "critical_overload_alert": bool,
            "switch_reason": str
        }
    """
    ts = pd.to_datetime(timestamp_str)
    hour = ts.hour

    is_evening_peak = 18 <= hour <= 22
    is_high_demand = demand_kw > 160.0

    # Rule 1 & 2: Grid Mode
    if is_high_demand or is_evening_peak:
        grid_mode = "Renewable Storage"
        reasons = []
        if is_high_demand:
            reasons.append(f"Demand ({demand_kw:.2f} kW) > 160 kW threshold")
        if is_evening_peak:
            reasons.append(f"Peak evening hours window (Hour {hour:02d}:00 in 18:00-22:00)")
        switch_reason = " & ".join(reasons)
    else:
        grid_mode = "Main Grid"
        switch_reason = f"Demand ({demand_kw:.2f} kW) <= 160 kW and outside peak window"

    # Rule 3: Independent Critical Overload Alert
    critical_overload_alert = demand_kw >= 200.0

    return {
        "timestamp": str(timestamp_str),
        "demand_kw": round(float(demand_kw), 2),
        "hour": hour,
        "grid_mode": grid_mode,
        "critical_overload_alert": critical_overload_alert,
        "switch_reason": switch_reason
    }


def simulate_battery_dispatch(
    forecast_records: List[Dict[str, Any]],
    initial_soc_pct: float = 85.0,
    battery_capacity_kwh: float = 400.0,
    max_discharge_kw: float = 80.0,
    max_charge_kw: float = 50.0,
    min_soc_pct: float = 20.0,
    max_soc_pct: float = 95.0
) -> List[Dict[str, Any]]:
    """
    Simulates battery State of Charge (SOC) progression and dispatch based on transition signals.
    Note: Output fields explicitly state '(Simulated)' per project rules.
    """
    current_soc_kwh = (initial_soc_pct / 100.0) * battery_capacity_kwh
    results = []

    for item in forecast_records:
        ts = item["timestamp"]
        demand = float(item["target_demand_kw"])
        solar = float(item.get("solar_irradiance_wm2", 0.0))
        
        rule_eval = evaluate_transition_rule(ts, demand)
        
        # Solar generation estimation: approx 0.15 kW per W/m2 of solar panel capacity (assuming 200 m2 effective array)
        estimated_solar_gen_kw = (solar / 1000.0) * 30.0  # 30 kW peak system

        discharged_kw = 0.0
        charged_kw = 0.0

        if rule_eval["grid_mode"] == "Renewable Storage":
            # Discharge battery to alleviate demand
            available_soc_kwh = current_soc_kwh - ((min_soc_pct / 100.0) * battery_capacity_kwh)
            if available_soc_kwh > 0:
                needed_discharge = min(demand, max_discharge_kw)
                discharged_kw = min(needed_discharge, available_soc_kwh)
                current_soc_kwh -= discharged_kw
        else:
            # Main Grid mode: use excess solar or off-peak power to top-up battery if below max_soc
            if estimated_solar_gen_kw > 5.0 and current_soc_kwh < ((max_soc_pct / 100.0) * battery_capacity_kwh):
                charge_potential = min(estimated_solar_gen_kw, max_charge_kw)
                room_in_battery = ((max_soc_pct / 100.0) * battery_capacity_kwh) - current_soc_kwh
                charged_kw = min(charge_potential, room_in_battery)
                current_soc_kwh += charged_kw

        soc_pct = round((current_soc_kwh / battery_capacity_kwh) * 100.0, 1)

        record_output = {
            **rule_eval,
            "solar_irradiance_wm2": solar,
            "battery_soc_pct_simulated": soc_pct,
            "battery_flow_kw_simulated": round(charged_kw - discharged_kw, 2),
            "simulated_tag": "Simulated Output"
        }
        results.append(record_output)

    return results
