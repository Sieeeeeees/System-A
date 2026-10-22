const API_BASE = "http://127.0.0.1:8000";
let refreshInterval;
let html5QrcodeScanner;

// --- DOM Elements ---
const el = {
    loginContainer: document.getElementById('login-container'),
    dashboard: document.getElementById('dashboard-container'),
    logoutBtn: document.getElementById('logout-btn'),
    loginForm: document.getElementById('login-form'),
    loginError: document.getElementById('login-error')
};

// --- Initialization ---
window.onload = () => {
    if (localStorage.getItem('admin_token')) showDashboard();
};

// --- Authentication ---
async function handleLogin(event) {
    event.preventDefault();
    const formData = new URLSearchParams();
    formData.append('username', document.getElementById('username').value);
    formData.append('password', document.getElementById('password').value);

    try {
        const response = await fetch(`${API_BASE}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formData
        });

        if (response.ok) {
            const data = await response.json();
            localStorage.setItem('admin_token', data.access_token);
            el.loginError.classList.add('hidden');
            showDashboard();
        } else {
            el.loginError.classList.remove('hidden');
        }
    } catch (error) { console.error("Login failed:", error); }
}

function logout() {
    localStorage.removeItem('admin_token');
    clearInterval(refreshInterval);
    closeCamera();
    
    el.dashboard.classList.add('hidden');
    el.logoutBtn.classList.add('hidden');
    el.loginContainer.classList.remove('hidden');
    el.loginForm.reset();
}

function showDashboard() {
    el.loginContainer.classList.add('hidden');
    el.dashboard.classList.remove('hidden');
    el.logoutBtn.classList.remove('hidden');
    
    // Initial fetch for everything
    refreshDashboard();
    fetchReports('today'); 
    
    // Auto-refresh main dashboard every 5 seconds
    refreshInterval = setInterval(refreshDashboard, 5000);
}

// --- API Helper ---
async function authFetch(url, options = {}) {
    const token = localStorage.getItem('admin_token');
    const response = await fetch(url, {
        ...options,
        headers: { ...options.headers, 'Authorization': `Bearer ${token}` }
    });
    if (response.status === 401) {
        logout();
        throw new Error("Unauthorized");
    }
    return response;
}

// --- Data Fetching ---
function refreshDashboard() {
    fetchOccupancy();
    fetchLogs();
    fetchAbsent(); 
}

async function fetchOccupancy() {
    try {
        const res = await authFetch(`${API_BASE}/occupancy`);
        const data = await res.json();
        document.getElementById('occupancy-count').textContent = data.current_occupancy;
    } catch (error) { console.error(error); }
}

// Recent Live Logs
async function fetchLogs() {
    try {
        const res = await authFetch(`${API_BASE}/logs`);
        const logs = await res.json();
        const tbody = document.getElementById('logs-body');
        
        tbody.innerHTML = logs.map(log => `
            <tr>
                <td>${log.student_id}</td>
                <td>${log.student_name}</td>
                <td>${log.timestamp}</td>
                <td class="${log.action === 'IN' ? 'status-in' : 'status-out'}">${log.action}</td>
            </tr>
        `).join('');
    } catch (error) { console.error(error); }
}

async function fetchAbsent() {
    try {
        const res = await authFetch(`${API_BASE}/absent`);
        const absentees = await res.json();
        const list = document.getElementById('absent-list');
        
        if (!list) return;
        
        if (absentees.length === 0) {
            list.innerHTML = `<li class="perfect">✅ Lahat ay pumasok ngayon! (Perfect Attendance)</li>`;
        } else {
            list.innerHTML = absentees.map(s => `<li>❌ ${s.student_id} - ${s.student_name}</li>`).join('');
        }
    } catch (error) { console.error(error); }
}

// --- NEW: Reports Fetching ---
async function fetchReports(period) {
    // Highlight the active button
    const buttons = ['today', 'yesterday', 'week'];
    buttons.forEach(p => {
        const btn = document.getElementById(`btn-rep-${p}`);
        if(p === period) {
            btn.classList.replace('btn-outline', 'btn-primary');
        } else {
            btn.classList.replace('btn-primary', 'btn-outline');
        }
    });

    try {
        const res = await authFetch(`${API_BASE}/reports?period=${period}`);
        const reports = await res.json();
        const tbody = document.getElementById('reports-body');
        
        if (reports.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No attendance logs found for this period.</td></tr>`;
            return;
        }

        tbody.innerHTML = reports.map(log => `
            <tr>
                <td>${log.student_id}</td>
                <td>${log.student_name}</td>
                <td>${log.timestamp}</td>
                <td class="${log.action === 'IN' ? 'status-in' : 'status-out'}">${log.action}</td>
            </tr>
        `).join('');
    } catch (error) { console.error("Error fetching reports:", error); }
}


// --- Data Submission ---
async function simulateScan(action) {
    const idInput = document.getElementById('student-id');
    const nameInput = document.getElementById('student-name');
    
    if (!idInput.value.trim() || !nameInput.value.trim()) {
        return alert("Please enter both Student ID and Name");
    }

    try {
        await authFetch(`${API_BASE}/scan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ student_id: idInput.value, student_name: nameInput.value, action })
        });
        idInput.value = ''; 
        nameInput.value = ''; 
        refreshDashboard();
        fetchReports('today'); // update reports tab if looking at today
    } catch (error) { console.error(error); }
}


// --- NEW: QR Generator Logic ---
function generateQR() {
    const id = document.getElementById('gen-student-id').value.trim();
    const name = document.getElementById('gen-student-name').value.trim();
    const displayBox = document.getElementById('qrcode-display');

    if (!id || !name) {
        alert("Please enter both Student ID and Name to generate a QR code.");
        return;
    }

    // Clear old QR code
    displayBox.innerHTML = "";

    // Generate new QR code combining ID and Name separated by a comma
    // Format: "2026-0001,Brics Coyoca"
    new QRCode(displayBox, {
        text: `${id},${name}`,
        width: 160,
        height: 160,
        colorDark : "#1f2937",
        colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.H
    });
}


// --- QR Scanner Controls ---
function toggleCamera() {
    const readerDiv = document.getElementById('qr-reader');
    const cameraBtn = document.getElementById('camera-btn');
    
    if (readerDiv.classList.contains('hidden')) {
        readerDiv.classList.remove('hidden');
        cameraBtn.textContent = 'Close Camera';
        cameraBtn.classList.replace('btn-primary', 'btn-out');
        
        html5QrcodeScanner = new Html5QrcodeScanner("qr-reader", { fps: 10, qrbox: {width: 250, height: 250} });
        html5QrcodeScanner.render(onScanSuccess, () => {}); 
    } else {
        closeCamera();
    }
}

function closeCamera() {
    const readerDiv = document.getElementById('qr-reader');
    const cameraBtn = document.getElementById('camera-btn');
    
    readerDiv.classList.add('hidden');
    cameraBtn.textContent = 'Open Camera';
    cameraBtn.classList.replace('btn-out', 'btn-primary');
    
    if (html5QrcodeScanner) html5QrcodeScanner.clear();
}

async function onScanSuccess(decodedText) {
    closeCamera();
    const data = decodedText.split(',');
    
    if (data.length >= 2) {
        const scanMode = document.getElementById('camera-mode').value;
        try {
            await authFetch(`${API_BASE}/scan`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    student_id: data[0].trim(), 
                    student_name: data[1].trim(),
                    action: scanMode 
                })
            });
            refreshDashboard();
            fetchReports('today');
            alert(`✅ Successfully Scanned ${scanMode}: ${data[1].trim()}`);
        } catch (error) { console.error(error); }
    } else {
        alert("❌ Invalid QR Format. Expecting 'StudentID,StudentName'");
    }
}

// --- Password Peek Logic ---
function togglePassword() {
    const passwordInput = document.getElementById('password');
    const eyeIcon = document.getElementById('eye-icon');
    
    if (passwordInput.type === 'password') {
        passwordInput.type = 'text'; 
        eyeIcon.innerHTML = `
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
            <line x1="1" y1="1" x2="23" y2="23"></line>
        `;
    } else {
        passwordInput.type = 'password'; 
        eyeIcon.innerHTML = `
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
            <circle cx="12" cy="12" r="3"></circle>
        `;
    }
}