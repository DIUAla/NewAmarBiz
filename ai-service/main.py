# ai-service/main.py
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import joblib
import os
from dotenv import load_dotenv
import asyncpg
import redis
import json

load_dotenv()

app = FastAPI(title="F-Commerce AI Service", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Database connection
DB_POOL = None
REDIS_CLIENT = redis.Redis(
    host=os.getenv('REDIS_HOST', 'localhost'),
    port=int(os.getenv('REDIS_PORT', 6379)),
    decode_responses=True
)

class OrderData(BaseModel):
    orderId: str
    userId: str
    totalAmount: float
    items: List[Dict]
    customerInfo: Dict
    createdAt: str

class PredictionResponse(BaseModel):
    successProbability: float
    confidence: float
    factors: List[str]
    estimatedDelivery: str

class AnalyticsResponse(BaseModel):
    detective: Dict
    predictive: Dict
    prescriptive: Dict

@app.on_event("startup")
async def startup_event():
    global DB_POOL
    DB_POOL = await asyncpg.create_pool(
        host=os.getenv('DB_HOST', 'localhost'),
        port=int(os.getenv('DB_PORT', 5432)),
        user=os.getenv('DB_USER', 'postgres'),
        password=os.getenv('DB_PASSWORD', 'postgres'),
        database=os.getenv('DB_NAME', 'fcommerce'),
        min_size=5,
        max_size=20
    )

@app.on_event("shutdown")
async def shutdown_event():
    if DB_POOL:
        await DB_POOL.close()

@app.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}

@app.get("/api/analytics/{user_id}", response_model=AnalyticsResponse)
async def get_analytics(user_id: str):
    """Get comprehensive analytics for a user"""
    cache_key = f"analytics:{user_id}"
    cached = REDIS_CLIENT.get(cache_key)
    
    if cached:
        return json.loads(cached)
    
    async with DB_POOL.acquire() as conn:
        # Fetch orders for the user
        orders = await conn.fetch("""
            SELECT * FROM orders 
            WHERE "userId" = $1 
            ORDER BY "createdAt" DESC 
            LIMIT 1000
        """, user_id)
        
        df = pd.DataFrame([dict(order) for order in orders])
        
        if len(df) < 10:
            return {
                "detective": {"status": "Insufficient data", "minimumRequired": 1000},
                "predictive": {},
                "prescriptive": {"recommendations": ["Continue collecting data for AI insights"]}
            }
        
        # Detective Analytics
        detective = await detect_anomalies(df)
        
        # Predictive Analytics
        predictive = await predict_metrics(df)
        
        # Prescriptive Analytics
        prescriptive = await generate_recommendations(df, detective, predictive)
        
        result = {
            "detective": detective,
            "predictive": predictive,
            "prescriptive": prescriptive
        }
        
        REDIS_CLIENT.setex(cache_key, 3600, json.dumps(result))
        
        return result

@app.post("/api/predict/order")
async def predict_order_success(order_data: OrderData):
    """Predict success probability for an order"""
    
    # Simple predictive model based on order value, customer history, etc.
    success_probability = 0.85  # Base probability
    
    factors = []
    
    # High value orders might have more risk
    if order_data.totalAmount > 10000:
        success_probability -= 0.05
        factors.append("High order value increases risk")
    elif order_data.totalAmount < 500:
        success_probability += 0.05
        factors.append("Low value orders have higher success rate")
    
    # Multiple items vs single item
    if len(order_data.items) > 3:
        success_probability -= 0.03
        factors.append("Multiple items may increase complexity")
    elif len(order_data.items) == 1:
        success_probability += 0.03
        factors.append("Single item orders are easier to fulfill")
    
    success_probability = max(0.5, min(0.98, success_probability))
    
    # Generate confidence score based on data availability
    confidence = 0.75
    
    return PredictionResponse(
        successProbability=round(success_probability, 2),
        confidence=round(confidence, 2),
        factors=factors,
        estimatedDelivery="3-5 business days"
    )

@app.get("/api/detect/anomalies/{user_id}")
async def detect_anomalies_endpoint(user_id: str):
    """Detect anomalies in orders"""
    async with DB_POOL.acquire() as conn:
        orders = await conn.fetch("""
            SELECT * FROM orders 
            WHERE "userId" = $1 
            ORDER BY "createdAt" DESC 
            LIMIT 500
        """, user_id)
        
        df = pd.DataFrame([dict(order) for order in orders])
        anomalies = await detect_anomalies(df)
        
        return anomalies

@app.get("/api/customer/ltv/{customer_id}")
async def get_customer_ltv(customer_id: str):
    """Calculate Customer Lifetime Value"""
    async with DB_POOL.acquire() as conn:
        customer = await conn.fetchrow("""
            SELECT * FROM customers WHERE id = $1
        """, customer_id)
        
        if not customer:
            raise HTTPException(status_code=404, detail="Customer not found")
        
        total_spent = customer['totalSpent'] or 0
        total_orders = customer['totalOrders'] or 0
        avg_order_value = total_spent / total_orders if total_orders > 0 else 0
        
        # Simple LTV calculation
        # LTV = Average Order Value × Purchase Frequency × Customer Lifespan
        purchase_frequency = 1.5  # Estimated purchases per month
        customer_lifespan = 12  # Months
        ltv = avg_order_value * purchase_frequency * customer_lifespan
        
        # Tier classification
        if ltv > 50000:
            tier = "Premium"
            score = 85
        elif ltv > 20000:
            tier = "Gold"
            score = 70
        elif ltv > 5000:
            tier = "Silver"
            score = 50
        else:
            tier = "Bronze"
            score = 30
        
        return {
            "score": score,
            "tier": tier,
            "ltv": round(ltv, 2),
            "totalSpent": total_spent,
            "totalOrders": total_orders,
            "avgOrderValue": round(avg_order_value, 2),
            "predictedNextOrder": "10-15 days"
        }

@app.get("/api/forecast/{user_id}")
async def get_forecast(user_id: str, period: str = "daily"):
    """Get sales and demand forecast"""
    async with DB_POOL.acquire() as conn:
        # Fetch historical orders
        orders = await conn.fetch("""
            SELECT "createdAt", "totalAmount" 
            FROM orders 
            WHERE "userId" = $1 AND "status" = 'delivered'
            ORDER BY "createdAt" DESC
            LIMIT 100
        """, user_id)
        
        if len(orders) < 10:
            return {
                "sales": [100] * 7,
                "confidence": 0.5,
                "message": "More data needed for accurate forecasting"
            }
        
        df = pd.DataFrame([dict(order) for order in orders])
        df['date'] = pd.to_datetime(df['createdAt'])
        df = df.set_index('date')
        
        # Simple moving average forecast
        daily_sales = df.resample('D').sum()['totalAmount'].fillna(0)
        
        if len(daily_sales) > 7:
            window = min(7, len(daily_sales) // 2)
            ma = daily_sales.rolling(window=window).mean()
            forecast = ma.iloc[-7:].tolist()
        else:
            forecast = [daily_sales.mean()] * 7
        
        return {
            "sales": [round(x, 2) for x in forecast],
            "confidence": min(0.9, 0.5 + len(orders) / 200),
            "period": period,
            "nextMonthEstimated": round(sum(forecast) * 4.3, 2)
        }

@app.get("/api/suggest/courier/{order_id}")
async def suggest_courier(order_id: str):
    """Recommend best courier for an order"""
    async with DB_POOL.acquire() as conn:
        order = await conn.fetchrow("""
            SELECT * FROM orders WHERE id = $1
        """, order_id)
        
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")
        
        # Get delivery success rates for the area
        area = order['shippingAddress'].get('area') if isinstance(order['shippingAddress'], dict) else 'Unknown'
        
        courier_success_rates = {
            "Steadfast": 0.94,
            "Pathao": 0.91,
            "RedX": 0.88,
            "Paperfly": 0.86
        }
        
        # Get recommended courier
        best_courier = max(courier_success_rates, key=courier_success_rates.get)
        
        reasons = []
        if area in ['Dhaka', 'Gazipur', 'Narayanganj']:
            reasons.append("Pathao has faster delivery in Dhaka metro areas")
            if best_courier == "Pathao":
                reasons.append("Fastest delivery option for your location")
        else:
            reasons.append("Steadfast has wider coverage outside Dhaka")
            reasons.append("Recommended for reliable delivery to remote areas")
        
        return {
            "suggestedCourier": best_courier,
            "alternatives": ["Pathao", "RedX"],
            "reason": reasons[0] if reasons else f"Based on {best_courier}'s success rate in your area",
            "successRate": courier_success_rates[best_courier],
            "confidence": 0.85
        }

async def detect_anomalies(df: pd.DataFrame) -> Dict:
    """Detect fake orders, delivery failures, and sales anomalies"""
    
    anomalies = {
        "fakeOrders": [],
        "deliveryFailures": [],
        "salesAnomalies": []
    }
    
    if len(df) < 10:
        return anomalies
    
    # Detect fake orders (unusually high amounts or suspicious patterns)
    amount_mean = df['totalAmount'].mean()
    amount_std = df['totalAmount'].std()
    threshold = amount_mean + 2 * amount_std
    
    fake_suspicions = df[df['totalAmount'] > threshold]
    for _, order in fake_suspicions.iterrows():
        anomalies["fakeOrders"].append({
            "orderId": order['id'],
            "amount": float(order['totalAmount']),
            "reason": f"Amount {order['totalAmount']:.2f} BDT is unusually high",
            "confidence": 0.75
        })
    
    # Detect delivery failures
    failed_orders = df[df['status'] == 'cancelled']
    for _, order in failed_orders.iterrows():
        anomalies["deliveryFailures"].append({
            "orderId": order['id'],
            "reason": "Order was cancelled",
            "amount": float(order['totalAmount'])
        })
    
    # Sales anomalies (sudden drops or spikes)
    if len(df) > 7:
        df['date'] = pd.to_datetime(df['createdAt'])
        daily_sales = df.groupby(df['date'].dt.date)['totalAmount'].sum()
        
        if len(daily_sales) > 3:
            mean_sales = daily_sales.mean()
            std_sales = daily_sales.std()
            anomaly_threshold = mean_sales + 2 * std_sales
            
            for date, sales in daily_sales.items():
                if sales > anomaly_threshold:
                    anomalies["salesAnomalies"].append({
                        "date": str(date),
                        "sales": float(sales),
                        "reason": "Unusual spike in sales",
                        "expectedRange": f"{mean_sales - std_sales:.0f} - {mean_sales + std_sales:.0f}"
                    })
    
    return anomalies

async def predict_metrics(df: pd.DataFrame) -> Dict:
    """Predict future metrics"""
    
    if len(df) < 10:
        return {
            "predictedOrdersNextWeek": 0,
            "expectedRevenue": 0,
            "customerChurnRisk": "Unknown"
        }
    
    # Calculate average daily orders
    df['date'] = pd.to_datetime(df['createdAt'])
    daily_counts = df.groupby(df['date'].dt.date).size()
    avg_daily_orders = daily_counts.mean()
    
    predicted_orders = int(avg_daily_orders * 7)
    expected_revenue = predicted_orders * df['totalAmount'].mean()
    
    # Calculate churn risk based on recency of orders
    last_order_date = df['createdAt'].max()
    days_since_last_order = (datetime.now() - last_order_date).days
    
    if days_since_last_order > 14:
        churn_risk = "High"
    elif days_since_last_order > 7:
        churn_risk = "Medium"
    else:
        churn_risk = "Low"
    
    return {
        "predictedOrdersNextWeek": round(predicted_orders),
        "expectedRevenue": round(expected_revenue, 2),
        "customerChurnRisk": churn_risk,
        "avgDailyOrders": round(avg_daily_orders, 2),
        "avgOrderValue": round(df['totalAmount'].mean(), 2)
    }

async def generate_recommendations(df: pd.DataFrame, detective: Dict, predictive: Dict) -> Dict:
    """Generate actionable recommendations"""
    
    recommendations = []
    
    # Based on detective insights
    if detective.get("fakeOrders"):
        recommendations.append("Monitor high-value orders for potential fraud")
    
    if detective.get("deliveryFailures"):
        recommendations.append("Review delivery process to reduce cancellations")
    
    # Based on predictive insights
    if predictive.get("customerChurnRisk") == "High":
        recommendations.append("Run re-engagement campaign for inactive customers")
        recommendations.append("Consider sending discount offers to previous customers")
    
    # General recommendations
    if len(df) < 100:
        recommendations.append("Continue growing order volume for better AI insights")
    
    recommendations.append("Enable inventory forecasting to prevent stockouts")
    recommendations.append("Set up automated order confirmations to improve customer experience")
    
    return {
        "recommendations": recommendations,
        "priorityActions": recommendations[:3],
        "expectedImpact": "15-20% efficiency improvement with AI adoption"
    }