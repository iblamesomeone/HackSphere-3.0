# HackSphere 3.0: Smart Energy Microgrid & Demand Forecasting Engine

An end-to-end intelligent microgrid demand forecasting and power dispatch system built for **HackSphere 3.0**, powered by **Zoho Catalyst QuickML** and automated transition control logic.

---

## 1. System Architecture

```
                  ┌───────────────────────────────────────────────┐
                  │          Interactive Web Dashboard            │
                  │   (Chart.js 24h Demand Curve & Battery SOC)   │
                  └───────────────────────┬───────────────────────┘
                                          │ HTTP / REST
                                          ▼
                  ┌───────────────────────────────────────────────┐
                  │            Flask Application Engine           │
                  │        (Ingestion, Schema Validation)         │
                  └───────────────┬───────────────┬───────────────┘
                                  │               │
                 Forecasting Feed │               │ Predictions
                                  ▼               ▼
        ┌──────────────────────────────────┐   ┌───────────────────────────────┐
        │  Zoho Catalyst QuickML Endpoint  │   │  Smart Transition Controller  │
        │(Energy_Demand_Regression_Model)  │   │   & Battery Dispatch Sim      │
        └──────────────────────────────────┘   └───────────────┬───────────────┘
                                                               │
                                         Dispatched Signals & Alerts
                                                               ▼
                                               [Main Grid / Renewable Storage]
                                               [Critical Overload >= 200 kW]
```

### Core Components
1. **QuickML Regression Model (`Energy_Demand_Regression_Model`)**:
   - Trained on historical telemetry (`train_telemetry.csv`, 4,000 rows).
   - Algorithm: Random Forest Regressor (`mlflow_random_forest_regression`).
   - Performance: **RMSE 23.49 kW** ($R^2 = 0.7815$, $MAE = 17.93$ kW) on validation evaluation.
   - Live Inference: Connected to published endpoint `Hacksphere-3` (ID: `9126000000002078`).
2. **Transition Controller Engine (`backend/transition_controller.py`)**:
   - Evaluates forecasted hourly demand (kW) and local timestamp hour against official microgrid rules.
   - **Renewable Storage Mode**: Triggered when predicted demand $> 160$ kW **OR** timestamp hour is in the evening peak window ($18:00 - 22:00$ inclusive).
   - **Main Grid Mode**: Active otherwise (demand $\le 160$ kW and outside peak hours).
   - **Critical Overload Alert**: Triggered independently whenever demand $\ge 200$ kW.
   - **Battery State of Charge (SOC)**: Simulates battery charge/discharge progression, explicitly labelled as `Simulated Output`.
3. **Responsive Dashboard (`frontend/`)**:
   - Modern dark UI with live KPI counters, dual-axis 24-hour demand & SOC curves, dynamic switching badges, and system audit logs.
   - Dual ingestion: Drag-and-drop CSV upload and manual 24-hour hourly weather vector table.
   - 1-Click sample data loader from `sample_test_input.csv`.

---

## 2. Environment Configuration

Create a `.env` file in the project root based on `.env.example`:

```env
# Zoho Catalyst QuickML Configuration
QUICKML_ENDPOINT_URL=https://api.catalyst.zoho.in/quickml/v1/project/88718000000013063/endpoints/predict
QUICKML_PROJECT_ID=88718000000013063
QUICKML_ORG_ID=60093044321
QUICKML_ENDPOINT_KEY=YOUR_QUICKML_ENDPOINT_KEY
QUICKML_ENVIRONMENT=Development
QUICKML_AUTH_TOKEN=YOUR_ZOHO_OAUTH_TOKEN

# Server Port
PORT=8000
```

> **Security Note**: Never commit real keys or OAuth tokens to Git. `.env` is excluded in `.gitignore`.

---

## 3. Local Installation & Execution

### Prerequisites
- Python 3.10+
- Node.js 18+

### Setup
```bash
# Clone the repository
git clone <repo-url>
cd Hacksphere\ 3.0

# Install dependencies
pip install -r requirements.txt
```

### Start the Application
To run the full end-to-end engine locally with the real QuickML model:
```bash
# 1. Start the QuickML Bridge
node backend/quickml_bridge.js &

# 2. Start the Backend API & Dashboard
python3 backend/app.py
```
Open your browser at: **`http://localhost:8000`**

---

## 4. Verification & Testing

### Official Evaluator Contract Check (`test_eval.py`)
Run the official pre-submission self-test script:
```bash
cd HackSphere_Starter_Kit
python3 test_eval.py
```
*Result: `SUCCESS` (Validates `predict(input_df)` contract on 1,000 real rows against QuickML).*

### Automated Prediction CLI (`predict.py`)
Run batch predictions from the command line:
```bash
python3 predict.py --input HackSphere_Starter_Kit/sample_test_input.csv --output predictions.csv
```
*Outputs formatted CSV predictions with columns `timestamp,target_demand_kw`.*

---

## 5. Zoho Catalyst Deployment

The project is configured for deployment on Zoho Catalyst:
- **Project Name**: `HackSphere-3` (ID: `88718000000013063`)
- **Domain**: `https://hacksphere-3-60093044321.development.catalystserverless.in`

To deploy using Catalyst CLI:
```bash
# Login to Zoho account
catalyst login

# Deploy all services
catalyst deploy
```
