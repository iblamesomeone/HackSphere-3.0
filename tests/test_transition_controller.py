import unittest
from backend.transition_controller import evaluate_transition_rule, simulate_battery_dispatch


class TestTransitionController(unittest.TestCase):
    
    def test_main_grid_baseline(self):
        # 14:00 (outside 18:00-22:00) and demand 120 kW (<= 160 kW)
        res = evaluate_transition_rule("2024-01-01 14:00:00", 120.0)
        self.assertEqual(res["grid_mode"], "Main Grid")
        self.assertFalse(res["critical_overload_alert"])
        
    def test_demand_threshold_exact_boundary(self):
        # Exactly 160.0 kW outside peak hours -> Demand > 160 is false -> Main Grid
        res_160 = evaluate_transition_rule("2024-01-01 12:00:00", 160.0)
        self.assertEqual(res_160["grid_mode"], "Main Grid")
        
        # 160.01 kW outside peak hours -> Renewable Storage
        res_160_01 = evaluate_transition_rule("2024-01-01 12:00:00", 160.01)
        self.assertEqual(res_160_01["grid_mode"], "Renewable Storage")
        
    def test_evening_peak_hours_inclusive(self):
        # Low demand (100 kW) during peak hours 18:00 to 22:00 inclusive
        for hour in [18, 19, 20, 21, 22]:
            ts = f"2024-01-01 {hour:02d}:00:00"
            res = evaluate_transition_rule(ts, 100.0)
            self.assertEqual(res["grid_mode"], "Renewable Storage", f"Hour {hour} failed")
            self.assertFalse(res["critical_overload_alert"])
            
        # Outside window boundaries (17:00 and 23:00) with low demand
        res_17 = evaluate_transition_rule("2024-01-01 17:00:00", 100.0)
        self.assertEqual(res_17["grid_mode"], "Main Grid")
        
        res_23 = evaluate_transition_rule("2024-01-01 23:00:00", 100.0)
        self.assertEqual(res_23["grid_mode"], "Main Grid")

    def test_critical_overload_alert_boundary(self):
        # 199.9 kW -> No overload alert
        res_199 = evaluate_transition_rule("2024-01-01 14:00:00", 199.9)
        self.assertEqual(res_199["grid_mode"], "Renewable Storage")  # Because > 160 kW
        self.assertFalse(res_199["critical_overload_alert"])

        # Exactly 200.0 kW -> Overload alert triggered
        res_200 = evaluate_transition_rule("2024-01-01 14:00:00", 200.0)
        self.assertEqual(res_200["grid_mode"], "Renewable Storage")
        self.assertTrue(res_200["critical_overload_alert"])

        # 250.0 kW during off-peak -> Overload alert triggered
        res_250 = evaluate_transition_rule("2024-01-01 03:00:00", 250.0)
        self.assertEqual(res_250["grid_mode"], "Renewable Storage")
        self.assertTrue(res_250["critical_overload_alert"])

    def test_simulated_battery_dispatch_labelling(self):
        sample_records = [
            {"timestamp": "2024-01-01 12:00:00", "target_demand_kw": 120.0, "solar_irradiance_wm2": 350.0},
            {"timestamp": "2024-01-01 19:00:00", "target_demand_kw": 190.0, "solar_irradiance_wm2": 0.0}
        ]
        sim_res = simulate_battery_dispatch(sample_records, initial_soc_pct=80.0)
        self.assertEqual(len(sim_res), 2)
        for row in sim_res:
            self.assertIn("battery_soc_pct_simulated", row)
            self.assertIn("simulated_tag", row)
            self.assertEqual(row["simulated_tag"], "Simulated Output")


if __name__ == "__main__":
    unittest.main()
