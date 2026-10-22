from fastapi import FastAPI, HTTPException, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel
import sqlite3
import datetime
from typing import List

app = FastAPI(title="AttendFlow API with Admin & Absent Checker")

# --- Configuration & Security ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "1234"
ADMIN_TOKEN = "super-secret-admin-token"
DB_NAME = "attendflow.db"

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")

def verify_admin(token: str = Depends(oauth2_scheme)):
    if token != ADMIN_TOKEN:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return True

# --- Database Setup ---
def get_db_connection():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute('''CREATE TABLE IF NOT EXISTS attendance
                     (id INTEGER PRIMARY KEY AUTOINCREMENT, 
                      student_id TEXT,
                      student_name TEXT, 
                      timestamp DATETIME, 
                      action TEXT)''')
        c.execute('''CREATE TABLE IF NOT EXISTS students
                     (student_id TEXT PRIMARY KEY, student_name TEXT)''')
                     
        c.execute("SELECT COUNT(*) FROM students")
        if c.fetchone()[0] == 0:
            sample_students = [
                ("2026-0001", "Brics Coyoca"),
                ("2026-0002", "Juan Dela Cruz"),
                ("2026-0003", "Maria Clara")
            ]
            c.executemany("INSERT INTO students (student_id, student_name) VALUES (?, ?)", sample_students)
        conn.commit()

init_db()

# --- Models ---
class ScanLog(BaseModel):
    student_id: str
    student_name: str
    action: str

# --- Routes ---
@app.post("/login")
async def login(form_data: OAuth2PasswordRequestForm = Depends()):
    if form_data.username == ADMIN_USERNAME and form_data.password == ADMIN_PASSWORD:
        return {"access_token": ADMIN_TOKEN, "token_type": "bearer"}
    raise HTTPException(status_code=400, detail="Incorrect username or password")

@app.post("/scan", dependencies=[Depends(verify_admin)])
async def record_scan(log: ScanLog):
    if log.action not in ["IN", "OUT"]:
        raise HTTPException(status_code=400, detail="Action must be IN or OUT")
    
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with get_db_connection() as conn:
        conn.execute(
            "INSERT INTO attendance (student_id, student_name, timestamp, action) VALUES (?, ?, ?, ?)", 
            (log.student_id, log.student_name, timestamp, log.action)
        )
        conn.commit()
    return {"status": "success"}

@app.get("/occupancy", dependencies=[Depends(verify_admin)])
async def get_occupancy():
    today = datetime.datetime.now().strftime("%Y-%m-%d")
    with get_db_connection() as conn:
        ins = conn.execute("SELECT COUNT(*) FROM attendance WHERE action='IN' AND timestamp LIKE ?", (f"{today}%",)).fetchone()[0]
        outs = conn.execute("SELECT COUNT(*) FROM attendance WHERE action='OUT' AND timestamp LIKE ?", (f"{today}%",)).fetchone()[0]
    return {"current_occupancy": max(0, ins - outs)}

@app.get("/logs", dependencies=[Depends(verify_admin)])
async def get_recent_logs(limit: int = 10):
    with get_db_connection() as conn:
        rows = conn.execute("SELECT student_id, student_name, timestamp, action FROM attendance ORDER BY timestamp DESC LIMIT ?", (limit,)).fetchall()
    return [{"student_id": r["student_id"], "student_name": r["student_name"], "timestamp": r["timestamp"], "action": r["action"]} for r in rows]

@app.get("/absent", dependencies=[Depends(verify_admin)])
async def get_absent_students():
    today = datetime.datetime.now().strftime("%Y-%m-%d")
    query = '''
        SELECT student_id, student_name FROM students 
        WHERE student_id NOT IN (
            SELECT student_id FROM attendance WHERE action='IN' AND timestamp LIKE ?
        )
    '''
    with get_db_connection() as conn:
        absent = conn.execute(query, (f"{today}%",)).fetchall()
    return [{"student_id": r["student_id"], "student_name": r["student_name"]} for r in absent]

@app.get("/reports", dependencies=[Depends(verify_admin)])
async def get_reports(period: str = "today"):
    now = datetime.datetime.now()
    
    # Calculate target dates
    today_str = now.strftime("%Y-%m-%d")
    yesterday_str = (now - datetime.timedelta(days=1)).strftime("%Y-%m-%d")
    week_ago_str = (now - datetime.timedelta(days=7)).strftime("%Y-%m-%d")

    query = "SELECT student_id, student_name, timestamp, action FROM attendance WHERE "
    params = ()

    if period == "yesterday":
        query += "timestamp LIKE ?"
        params = (f"{yesterday_str}%",)
    elif period == "week":
        query += "timestamp >= ?"
        params = (f"{week_ago_str} 00:00:00",)
    else: # Default to today
        query += "timestamp LIKE ?"
        params = (f"{today_str}%",)

    query += " ORDER BY timestamp DESC"

    with get_db_connection() as conn:
        rows = conn.execute(query, params).fetchall()
        
    return [{"student_id": r["student_id"], "student_name": r["student_name"], "timestamp": r["timestamp"], "action": r["action"]} for r in rows]