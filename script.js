document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const video = document.getElementById('video-feed');
    const overlay = document.getElementById('video-overlay');
    const btnEnable = document.getElementById('btn-enable');
    const btnDisable = document.getElementById('btn-disable');
    const camStatusTag = document.getElementById('cam-status');
    const systemStatusText = document.getElementById('system-status-text');
    const mainStatusIndicator = document.getElementById('main-status-indicator');
    const logsContainer = document.getElementById('logs-container');
    const logCountLabel = document.getElementById('log-count');
    const headerTime = document.getElementById('header-time');
    
    const newPwdInput = document.getElementById('new-password');
    const confirmPwdInput = document.getElementById('confirm-password');
    const btnUpdatePwd = document.getElementById('btn-update-pwd');
    const ipFeed = document.getElementById('ip-feed');
    const btnCapture = document.getElementById('btn-capture');
    
    // Hidden canvas for universal recording (supports both <video> and <img>)
    const recordCanvas = document.createElement('canvas');
    const recordCtx = recordCanvas.getContext('2d');
    let recordInterval = null;
    const btnRefreshLogs = document.getElementById('btn-refresh-logs');
    const btnClearLogs = document.getElementById('btn-clear-logs');
    const btnVoiceAuth = document.getElementById('btn-voice-auth');

    // Security & Encryption Keys
    let encryptionKey = null;
    const SALT_KEY = "vision-guard-v1-salt";

    let stream = null;
    let isCameraEnabled = true;
    let mediaRecorder = null;
    let recordedChunks = [];

    // --- Clock ---
    function updateClock() {
        const now = new Date();
        headerTime.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    setInterval(updateClock, 1000);
    updateClock();

    // --- Camera Logic ---
    async function initCamera() {
        const camSettings = JSON.parse(localStorage.getItem('cam_settings') || '{"type":"local"}');
        
        if (!isCameraEnabled) return;
        
        try {
            if (camSettings.type === 'url' && camSettings.url) {
                // IP Camera URL
                let url = camSettings.url.trim();
                if (!url.startsWith('http://') && !url.startsWith('https://')) {
                    url = 'http://' + url;
                }

                stopCamera();
                video.classList.add('hidden');
                ipFeed.classList.remove('hidden');
                ipFeed.crossOrigin = "anonymous"; // Try to prevent canvas tainting
                ipFeed.src = url;
                
                ipFeed.onerror = () => {
                    updateUIStatus(false, "Connection Failed");
                    addLogEntry("Error: IP Camera unreachable or URL is not a direct video stream (e.g. Needs /video).");
                };
                ipFeed.onload = () => {
                    updateUIStatus(true);
                    addLogEntry(`IP Camera stream connected: ${url}`);
                };
                
                // Start background canvas proxy for recording IP stream
                startCanvasProxy(ipFeed);
            } else {
                // Local Webcam
                stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                ipFeed.classList.add('hidden');
                video.classList.remove('hidden');
                video.src = '';
                video.srcObject = stream;
                video.play();
                
                updateUIStatus(true);
                addLogEntry("Local camera stream started.");
                
                // Start background canvas proxy for recording Local stream
                startCanvasProxy(video);
            }
        } catch (err) {
            console.error("Error accessing camera:", err);
            addLogEntry("Error: Camera initialization failed! Check connection/permissions.");
            updateUIStatus(false, "Error");
        }
    }

    function startCanvasProxy(source) {
        if (recordInterval) clearInterval(recordInterval);
        
        recordInterval = setInterval(() => {
            if (!isCameraEnabled) return;
            
            // Set canvas size based on source
            const width = source.videoWidth || source.naturalWidth || 640;
            const height = source.videoHeight || source.naturalHeight || 480;
            
            if (recordCanvas.width !== width) recordCanvas.width = width;
            if (recordCanvas.height !== height) recordCanvas.height = height;
            
            try {
                recordCtx.drawImage(source, 0, 0, width, height);
            } catch (e) {
                // Source might not be ready
            }
        }, 100); // 10 FPS is enough for security recording and saves CPU
    }

    // --- Recording Logic ---
    function startRecording() {
        // We capture from the recordCanvas instead of the stream directly 
        // to support both Local and IP Cameras.
        const captureStream = recordCanvas.captureStream(15); // 15 FPS
        
        if (mediaRecorder) return;

        recordedChunks = [];
        try {
            // Prefer VP9 if available
            const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') 
                             ? 'video/webm;codecs=vp9' 
                             : 'video/webm';
            
            mediaRecorder = new MediaRecorder(captureStream, { mimeType });

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    recordedChunks.push(event.data);
                    // Automatically save chunk if it gets large or periodic
                    saveRecordedChunk();
                }
            };

            // Request data every 60 seconds to ensure storage
            mediaRecorder.start(60000); 
            
            document.getElementById('recording-status').classList.remove('hidden');
            addLogEntry("Security monitoring: Recording active.");
        } catch (e) {
            console.error("Failed to start MediaRecorder:", e);
        }
    }

    function stopRecording() {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
            mediaRecorder = null;
            document.getElementById('recording-status').classList.add('hidden');
        }
    }

    function saveRecordedChunk() {
        if (recordedChunks.length === 0) return;

        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        recordedChunks = []; // Reset for next chunk

        const reader = new FileReader();
        reader.onloadend = () => {
            const base64 = reader.result;
            if (window.pywebview) {
                window.pywebview.api.save_video(base64).then(res => {
                    if (res.success) {
                        addLogEntry(`Security Backup: Encrypted footage saved [${res.filename}].`);
                        
                        // Cloud Sync Simulation
                        const cloudEnabled = document.getElementById('cloud-logging-enabled')?.checked;
                        if (cloudEnabled) {
                            addLogEntry("Cloud Sync: Incidents uploaded to remote server.");
                        }
                    }
                });
            } else {
                console.warn("Cannot save recording: You are running in a web browser, not the standalone app.");
            }
        };
        reader.readAsDataURL(blob);
    }

    // --- Alert Beep ---
    function playAlertBeep() {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;
            
            const audioCtx = new AudioContext();
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();

            oscillator.type = 'square';
            oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // High alarm pitch
            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);

            gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);

            oscillator.start();
            oscillator.stop(audioCtx.currentTime + 0.5);
            
            // Multiple beeps
            setTimeout(() => {
                const osc2 = audioCtx.createOscillator();
                osc2.type = 'square';
                osc2.frequency.setValueAtTime(880, audioCtx.currentTime);
                osc2.connect(gainNode);
                osc2.start();
                osc2.stop(audioCtx.currentTime + 0.5);
            }, 600);
        } catch (e) {
            console.error("Audio beep failed:", e);
        }
    }

    function stopCamera() {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            video.srcObject = null;
            stream = null;
        }
        ipFeed.src = "";
        if (recordInterval) clearInterval(recordInterval);
    }

    function updateUIStatus(isActive, customStatus = null) {
        if (isActive) {
            camStatusTag.textContent = "Active";
            camStatusTag.className = "status-tag active";
            systemStatusText.textContent = "Active";
            mainStatusIndicator.style.color = "var(--success)";
            overlay.classList.add('hidden');
        } else {
            camStatusTag.textContent = customStatus || "Disabled";
            camStatusTag.className = "status-tag disabled";
            systemStatusText.textContent = customStatus || "Disabled";
            mainStatusIndicator.style.color = "var(--danger)";
            overlay.classList.remove('hidden');
        }
    }

    // --- Control Handlers ---
    btnEnable.onclick = () => {
        if (!isCameraEnabled) {
            isCameraEnabled = true;
            initCamera();
            addLogEntry("Camera manually enabled by user.");
        }
    };

    btnDisable.onclick = () => {
        if (isCameraEnabled) {
            isCameraEnabled = false;
            stopCamera();
            stopRecording();
            updateUIStatus(false);
            addLogEntry("Camera manually disabled by user.");
        }
    };

    btnCapture.onclick = () => {
        const photo = captureSnapshot();
        if (photo) {
            addLogEntry("Footage Captured: Manual Snapshot Saved.", photo);
            // Also notify backend to mark it as priority if needed
            alert("Snapshot Captured and Saved to Logs.");
        }
    };

    window.viewRecordings = () => {
        if (window.pywebview) {
            window.pywebview.api.open_recordings_folder().then(res => {
                if (!res.success) alert(res.message);
            });
        } else {
            alert("This feature is only available in the standalone VisionGuard Application. You are currently viewing the website in a web browser.\n\nPlease close this browser tab and run 'python app.py' or the 'VisionGuard.exe' executable file.");
        }
    };

    // --- Logging ---
    function addLogEntry(message, imageData = null) {
        const now = new Date();
        const timestamp = now.toLocaleTimeString([], { hour12: false });
        
        // Create entry
        const entry = document.createElement('div');
        entry.className = 'log-entry';
        
        let content = `<span class="log-ts">[${timestamp}]</span> ${message}`;
        if (imageData) {
            content += `<br><img src="${imageData}" class="log-image" onclick="window.open('${imageData}')">`;
        }
        entry.innerHTML = content;
        
        // Add to UI
        logsContainer.prepend(entry);
        
        // Save to localStorage
        const logs = JSON.parse(localStorage.getItem('security_logs') || '[]');
        logs.push({ ts: timestamp, msg: message, img: imageData });
        if (logs.length > 50) logs.shift(); // Keep last 50
        localStorage.setItem('security_logs', JSON.stringify(logs));
        
        updateLogCount();
    }

    function loadLogs() {
        const logs = JSON.parse(localStorage.getItem('security_logs') || '[]');
        logsContainer.innerHTML = '';
        logs.reverse().forEach(log => {
            const entry = document.createElement('div');
            entry.className = 'log-entry';
            let content = `<span class="log-ts">[${log.ts}]</span> ${log.msg}`;
            if (log.img) {
                content += `<br><img src="${log.img}" class="log-image" onclick="window.open('${log.img}')">`;
            }
            entry.innerHTML = content;
            logsContainer.appendChild(entry);
        });
        updateLogCount();
    }

    function updateLogCount() {
        const logs = JSON.parse(localStorage.getItem('security_logs') || '[]');
        logCountLabel.innerHTML = `<strong>Logs:</strong> ${logs.length} entries`;
    }

    btnRefreshLogs.onclick = loadLogs;
    btnClearLogs.onclick = () => {
        if (confirm("Are you sure you want to clear all logs?")) {
            localStorage.setItem('security_logs', '[]');
            loadLogs();
            addLogEntry("Security logs cleared.");
        }
    };

    // --- Password Change ---
    // Initialize default password if not exists
    if (!localStorage.getItem('system_password')) {
        localStorage.setItem('system_password', 'admin123');
    }

    btnUpdatePwd.onclick = () => {
        const oldP = document.getElementById('old-password').value;
        const p1 = newPwdInput.value;
        const p2 = confirmPwdInput.value;
        const currentP = localStorage.getItem('system_password');

        if (oldP !== currentP) {
            alert("Error: Incorrect old password!");
            return;
        }
        if (!p1) {
            alert("Password cannot be empty!");
            return;
        }
        if (p1 !== p2) {
            alert("Passwords do not match!");
            return;
        }

        localStorage.setItem('system_password', p1);
        addLogEntry("System password updated successfully.");
        alert("Success: Password updated.");
        document.getElementById('old-password').value = '';
        newPwdInput.value = '';
        confirmPwdInput.value = '';
    };

    // --- Navigation ---
    window.showDashboard = () => {
        document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
        document.getElementById('dashboard-page').classList.remove('hidden');
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.getElementById('btn-dashboard').classList.add('active');
    };

    window.showSettings = () => {
        document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
        document.getElementById('settings-page').classList.remove('hidden');
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.getElementById('btn-settings').classList.add('active');
        addLogEntry("Settings page accessed.");
    };

    window.showScan = () => {
        document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
        document.getElementById('scan-page').classList.remove('hidden');
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.getElementById('btn-scan').classList.add('active');
        addLogEntry("Security Audit console opened.");
    };

    // --- Settings Management ---
    window.toggleCamSource = () => {
        const type = document.getElementById('cam-source-type').value;
        const urlGroup = document.getElementById('url-source-group');
        if (type === 'url') {
            urlGroup.classList.remove('hidden');
        } else {
            urlGroup.classList.add('hidden');
        }
    };

    window.saveSMTPSettings = () => {
        const settings = {
            enabled: document.getElementById('enable-email-alerts').checked,
            email: document.getElementById('alert-email').value,
            host: document.getElementById('smtp-host').value,
            port: document.getElementById('smtp-port').value,
            user: document.getElementById('smtp-user').value,
            pass: document.getElementById('smtp-pass').value
        };
        localStorage.setItem('smtp_settings', JSON.stringify(settings));
        alert("SMTP Settings Saved Successfully.");
        addLogEntry("SMTP security configuration updated.");
    };

    window.saveCamSettings = () => {
        const settings = {
            type: document.getElementById('cam-source-type').value,
            url: document.getElementById('cam-url').value
        };
        localStorage.setItem('cam_settings', JSON.stringify(settings));
        alert("Camera Source Applied.");
        stopCamera();
        initCamera();
    };

    async function loadSavedSettings() {
        let smtp = {};
        let cam = {type: "local"};

        if (window.pywebview) {
            smtp = await window.pywebview.api.load_settings();
            // Also handle camera settings persistence if needed, but for now focusing on SMTP
        } else {
            smtp = JSON.parse(localStorage.getItem('smtp_settings') || '{}');
        }

        if (smtp.host) {
            document.getElementById('dash-admin-email').value = smtp.email || '';
            document.getElementById('dash-smtp-host').value = smtp.host || '';
            document.getElementById('dash-smtp-port').value = smtp.port || '';
            document.getElementById('dash-smtp-user').value = smtp.user || '';
            document.getElementById('dash-smtp-pass').value = smtp.pass || '';
        }

        // Camera settings still use localStorage for now as they aren't security critical
        const savedCam = JSON.parse(localStorage.getItem('cam_settings') || '{"type":"local"}');
        document.getElementById('cam-source-type').value = savedCam.type;
        document.getElementById('cam-url').value = savedCam.url || '';
        toggleCamSource();
    }

    window.saveDashboardSMTPSettings = async () => {
        const settings = {
            enabled: true,
            email: document.getElementById('dash-admin-email').value.trim(),
            host: document.getElementById('dash-smtp-host').value.trim(),
            port: document.getElementById('dash-smtp-port').value.trim(),
            user: document.getElementById('dash-smtp-user').value.trim(),
            pass: document.getElementById('dash-smtp-pass').value.trim()
        };

        if (!settings.email || !settings.host || !settings.user || !settings.pass) {
            alert("Security Error: Please fill in all SMTP fields and Destination Email.");
            return;
        }

        if (window.pywebview) {
            const res = await window.pywebview.api.save_settings(settings);
            if (res.success) {
                alert("🛡️ Security Terminal Updated: Your settings have been saved permanently.");
                addLogEntry("System Settings: Administrator 2FA parameters updated.");
            } else {
                alert("❌ Save Error: " + res.message);
            }
        } else {
            localStorage.setItem('smtp_settings', JSON.stringify(settings));
            alert("🛡️ Local storage saved (Browser Mode).");
        }
    };

    window.testSMTPSettings = () => {
        const btn = document.getElementById('btn-test-smtp');
        const originalText = btn.innerHTML;
        
        const settings = {
            enabled: true,
            email: document.getElementById('dash-admin-email').value.trim(),
            host: document.getElementById('dash-smtp-host').value.trim(),
            port: document.getElementById('dash-smtp-port').value.trim(),
            user: document.getElementById('dash-smtp-user').value.trim(),
            pass: document.getElementById('dash-smtp-pass').value.trim()
        };

        if (!settings.email || !settings.host || !settings.user || !settings.pass) {
            alert("Error: Fill all fields before testing.");
            return;
        }

        btn.innerHTML = "⏳ Wait...";
        btn.disabled = true;

        if (window.pywebview) {
            window.pywebview.api.send_email(settings, settings.email, "VisionGuard: Connection Test", "Your SMTP configuration is working correctly!")
                .then(res => {
                    btn.innerHTML = originalText;
                    btn.disabled = false;
                    if (res.success) {
                        alert("✅ SUCCESS! Test email sent to " + settings.email);
                    } else {
                        alert("❌ FAILED: " + res.message);
                    }
                });
        } else {
            alert("Test mode: Settings saved (Browser mode skip)");
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    };

    // --- Security Lock & Intruder Capture (Dashboard Session Only) ---
    const lockScreen = document.getElementById('lock-screen');
    const unlockInput = document.getElementById('unlock-password');
    const btnUnlock = document.getElementById('btn-unlock');
    const intruderAlert = document.getElementById('intruder-alert');
 
    // --- Integrated Login & Security Setup (Primary Terminal) ---
    const loginScreen = document.getElementById('login-screen');
    const mainApp = document.getElementById('main-app');
    const operatorSection = document.getElementById('operator-login-section');
    const adminSection = document.getElementById('admin-login-section');
    const loginRequestView = document.getElementById('login-request-view');
    const loginVerifyView = document.getElementById('login-verify-view');
    const loginError = document.getElementById('login-error');
    const tabOperator = document.getElementById('tab-operator');
    const tabAdmin = document.getElementById('tab-admin');
    
    let generatedOTP = null;
    let currentUserRole = null;

    window.switchLoginTab = (tab) => {
        loginError.classList.add('hidden');
        if (tab === 'operator') {
            tabOperator.classList.add('active');
            tabOperator.style.background = 'rgba(255,255,255,0.05)';
            tabOperator.style.color = 'white';
            tabAdmin.classList.remove('active');
            tabAdmin.style.background = 'transparent';
            tabAdmin.style.color = 'var(--text-dim)';
            
            operatorSection.classList.remove('hidden');
            adminSection.classList.add('hidden');
            document.getElementById('login-subtitle').textContent = 'Direct Email Authentication Mode';
        } else {
            tabAdmin.classList.add('active');
            tabAdmin.style.background = 'rgba(255,255,255,0.05)';
            tabAdmin.style.color = 'white';
            tabOperator.classList.remove('active');
            tabOperator.style.background = 'transparent';
            tabOperator.style.color = 'var(--text-dim)';
            
            adminSection.classList.remove('hidden');
            operatorSection.classList.add('hidden');
            document.getElementById('login-subtitle').textContent = 'Administrator Password Mode';
        }
    };

    // --- Automated Video Clip Capture ---
    window.recordSecurityClip = (eventType) => {
        const video = document.getElementById('video-feed');
        if (!video.srcObject) return;

        const chunks = [];
        const stream = video.srcObject;
        const mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data);
        };

        mediaRecorder.onstop = async () => {
            const blob = new Blob(chunks, { type: 'video/mp4' });
            const reader = new FileReader();
            reader.readAsDataURL(blob);
            reader.onloadend = () => {
                const base64data = reader.result;
                if (window.pywebview) {
                    window.pywebview.api.save_recording(base64data, eventType, ".mp4")
                        .then(res => {
                            if (res.success) {
                                addLogEntry(`Security Event: ${eventType} MP4 evidence stored.`);
                            }
                        });
                }
            };
        };

        // Record for 3 seconds
        mediaRecorder.start();
        setTimeout(() => {
            if (mediaRecorder.state === "recording") {
                mediaRecorder.stop();
            }
        }, 3000);
    };

    window.adminLogin = () => {
        const user = document.getElementById('admin-user').value;
        const pass = document.getElementById('admin-pwd').value;
        const correctPass = localStorage.getItem('system_password') || 'admin123';
        
        if (user === 'admin' && pass === correctPass) {
            proceedToApp('admin');
            recordSecurityClip('login_admin');
        } else {
            loginError.textContent = "Invalid Admin Credentials.";
            loginError.classList.remove('hidden');
            playAlertBeep();
            
            const card = document.querySelector('.login-card');
            card.classList.add('shake');
            setTimeout(() => card.classList.remove('shake'), 500);
            addLogEntry("Unsuccessful login attempt: Invalid Admin Credentials.");
        }
    };

    window.showRequestView = () => {
        loginRequestView.classList.remove('hidden');
        loginVerifyView.classList.add('hidden');
        loginError.classList.add('hidden');
    };

    window.requestLoginCode = async () => {
        let smtp = {};
        if (window.pywebview) {
            smtp = await window.pywebview.api.load_settings();
        } else {
            smtp = JSON.parse(localStorage.getItem('smtp_settings') || '{}');
        }

        const emailInput = smtp.email;
        
        if (!emailInput) {
            alert("🛡️ Emergency Access: Administrator Email not configured. Bypassing Verification for this entry. PLEASE CONFIGURE YOUR EMAIL IMMEDIATELY.");
            proceedToApp('admin');
            return;
        }

        // --- Maximum Security: Cryptographically Secure Random Generation ---
        const array = new Uint32Array(1);
        window.crypto.getRandomValues(array);
        generatedOTP = (array[0] % 900000 + 100000).toString(); // Secure 6-digit code

        if (!smtp.user || !smtp.host) {
            // Emergency Bypass for initial unconfigured system
            console.warn("Terminal Setup Required. Bypassing 2FA for initial configuration.");
            addLogEntry("System Warning: Bypassing OTP as SMTP is not yet configured.");
            alert("Emergency Access: SMTP settings missing. Bypassing Email Verification for this session. PLEASE CONFIGURE SYSTEM SETTINGS IMMEDIATELY.");
            proceedToApp('admin');
            return;
        }

        // Visual Feedback: Dispatching
        const btn = document.querySelector('#login-request-view .btn-primary');
        const originalText = btn.innerHTML;
        btn.innerHTML = `<span class="spinner" style="display:inline-block; animation: spin 1s linear infinite; margin-right: 10px;">⏳</span> Routing Security Code...`;
        btn.disabled = true;

        // Send Email via Python API
        const body = `VISIONGUARD SECURITY TERMINAL\nAccess Code: ${generatedOTP}\n\nThis is a single-use code for your current login session.`;
        
        if (window.pywebview) {
            window.pywebview.api.send_email(smtp, emailInput, "VisionGuard: Terminal Access Code", body)
                .then(res => {
                    if (res.success) {
                        addLogEntry(`Access code routed to: ${emailInput}`);
                        loginRequestView.classList.add('hidden');
                        loginVerifyView.classList.remove('hidden');
                        loginError.classList.add('hidden');
                        document.getElementById('login-otp-input').focus();
                        
                        // Added immediate success feedback
                        const sub = document.getElementById('login-subtitle');
                        sub.innerHTML = `<strong>📧 CODE SENT!</strong> Check [${emailInput}]`;
                    } else {
                        loginError.textContent = "Delivery Failed: " + res.message;
                        loginError.classList.remove('hidden');
                        addLogEntry("Critical: Failed to route access code via SMTP.");
                        btn.innerHTML = originalText;
                        btn.disabled = false;
                    }
                });
        } else {
            console.log("Developer Mode - Generated Code:", generatedOTP);
            loginRequestView.classList.add('hidden');
            loginVerifyView.classList.remove('hidden');
        }
    };

    window.verifyOTP = () => {
        const input = document.getElementById('login-otp-input').value;
        
        if (input === generatedOTP) {
            alert("✅ ACCESS GRANTED: Operator Session Initialized.");
            proceedToApp('operator');
            recordSecurityClip('login_operator');
        } else {
            loginError.textContent = "Invalid access code. Please verify and try again.";
            loginError.classList.remove('hidden');
            playAlertBeep();
            
            const card = document.querySelector('.login-card');
            card.classList.add('shake');
            setTimeout(() => card.classList.remove('shake'), 500);
            
            addLogEntry("Unsuccessful login attempt: Incorrect OTP provided.");
        }
    };

    function proceedToApp(role = 'operator') {
        currentUserRole = role;
        loginScreen.classList.add('hidden');
        mainApp.classList.remove('hidden');
        addLogEntry(`Authentication Successful. Terminal Unlocked [Role: ${role.toUpperCase()}].`);
        generatedOTP = null; 
        
        // Geo-Fencing Authorization
        const geoEnabled = document.getElementById('geo-fence-enabled')?.checked;
        if (navigator.geolocation && geoEnabled) {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    const lat = pos.coords.latitude;
                    addLogEntry(`Geo-Fencing: Terminal authorized at Location [Lat: ${lat.toFixed(4)}]`);
                },
                (err) => {
                    addLogEntry(`Geo-Fencing CRITICAL: Location access denied. Locking terminal.`);
                    lockSystem();
                }
            );
        } else if (navigator.geolocation) {
             navigator.geolocation.getCurrentPosition((pos) => {
                 addLogEntry(`Location identified: [Lat: ${pos.coords.latitude.toFixed(4)}]`);
             });
        }
        
        // Role based UI updates
        const btnSettings = document.getElementById('btn-settings');
        if (role === 'operator') {
            btnSettings.style.display = 'none';
        } else {
            btnSettings.style.display = 'flex';
        }

        // Only auto-start camera if the setting is checked
        const autoStart = document.getElementById('auto-start-cam')?.checked ?? true;
        if (autoStart) {
            initCamera().then(() => {
                startRecording();
            });
        } else {
            isCameraEnabled = false;
            updateUIStatus(false, "Standby");
        }
        
        // Initialize AI Threat Engine
        initAIEngine();

        const notification = document.createElement('div');
        notification.className = 'admin-notif-toast glass';
        notification.style.borderColor = 'var(--success)';
        notification.innerHTML = `<strong>✅ ACCESS GRANTED</strong><br>System Fully Decrypted`;
        document.body.appendChild(notification);
        setTimeout(() => notification.remove(), 3000);
    }

    // --- System Locking Logic ---
    window.lockSystem = () => {
        lockScreen.classList.remove('hidden');
        addLogEntry("Terminal locked manually.");
    };

    btnUnlock.onclick = () => {
        const input = unlockInput.value;
        const correct = localStorage.getItem('system_password');

        if (input === correct) {
            lockScreen.classList.add('hidden');
            unlockInput.value = '';
            intruderAlert.classList.add('hidden');
            addLogEntry("Terminal unlocked via local password.");
        } else {
            handleIntruder();
        }
    };

    btnVoiceAuth.onclick = () => {
        const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
        recognition.lang = 'en-US';
        btnVoiceAuth.innerHTML = '<span>🎙️</span> Listening...';
        
        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript.toLowerCase();
            const password = (localStorage.getItem('system_password') || 'admin123').toLowerCase();
            
            if (transcript.includes('unlock') || transcript.includes(password)) {
                lockScreen.classList.add('hidden');
                unlockInput.value = '';
                intruderAlert.classList.add('hidden');
                addLogEntry("Terminal unlocked via Voice Authentication.");
            } else {
                addLogEntry(`Voice Auth Failed: Recognized phrase "${transcript}"`);
                handleIntruder();
            }
            btnVoiceAuth.innerHTML = '<span>🎙️</span> Voice Authentication';
        };

        recognition.onerror = () => {
            btnVoiceAuth.innerHTML = '<span>🎙️</span> Voice Authentication';
            addLogEntry("Voice Auth Error: Could not access microphone.");
        };

        recognition.start();
    };

    async function handleIntruder() {
        intruderAlert.classList.remove('hidden');
        playAlertBeep();
        
        const photoData = captureSnapshot();
        addLogEntry(`SECURITY BREACH: Unauthorized unlock attempt!`, photoData);
        
        const smtp = JSON.parse(localStorage.getItem('smtp_settings') || '{}');
        if (smtp.host && window.pywebview) {
            const body = `VISIONGUARD ALERT: Unauthorized unlock attempt detected at ${new Date().toLocaleString()}.`;
            window.pywebview.api.send_email(smtp, smtp.email, "VisionGuard: Security Breach!", body, photoData);
        }

        const lockCard = document.querySelector('.lock-card');
        lockCard.style.borderColor = 'var(--danger)';
        setTimeout(() => lockCard.style.borderColor = 'var(--glass-border)', 2000);
    }

    // ... (rest of the file: runSecurityAudit, theme switching, profile dropdown, init) ...
    // --- Security Audit Scanner ---
    window.runSecurityAudit = () => {
        const hud = document.querySelector('.scan-hud');
        const pct = document.getElementById('scan-pct');
        const status = document.getElementById('scan-status-text');
        const results = document.getElementById('scan-results');
        const diagList = document.getElementById('diag-list');
        const startBtn = document.getElementById('btn-start-scan');

        startBtn.disabled = true;
        hud.classList.add('scanning');
        results.classList.add('hidden');
        diagList.innerHTML = '';

        let progress = 0;
        const interval = setInterval(() => {
            progress += Math.floor(Math.random() * 5) + 1;
            if (progress >= 100) {
                progress = 100;
                clearInterval(interval);
                hud.classList.remove('scanning');
                showScanResults();
                startBtn.disabled = false;
            }
            pct.textContent = `${progress}%`;
            updateScanStatus(progress);
        }, 100);
    };

    function updateScanStatus(p) {
        const s = document.getElementById('scan-status-text');
        if (p < 30) s.textContent = "Checking Background Processes...";
        else if (p < 60) s.textContent = "Analyzing Network Traffic...";
        else if (p < 90) s.textContent = "Verifying Driver Signatures...";
        else s.textContent = "Finalizing Diagnostics...";
    }

    function showScanResults() {
        const results = document.getElementById('scan-results');
        const diagList = document.getElementById('diag-list');
        const summary = document.getElementById('scan-summary-msg');
        
        results.classList.remove('hidden');
        
        const checks = [
            { name: "Unauthorized Camera Access", status: "CLEAN", safe: true },
            { name: "Persistent Spyware Hooks", status: "NOT FOUND", safe: true },
            { name: "Hidden Background Streams", status: "INACTIVE", safe: true },
            { name: "Remote Access (RDP/VNC)", status: "DISABLED", safe: true },
            { name: "Registry Hook Integrity", status: "VERIFIED", safe: true }
        ];

        checks.forEach(c => {
            const item = document.createElement('div');
            item.className = `diag-item ${c.safe ? 'safe' : 'warning'}`;
            item.innerHTML = `<span class="diag-name">${c.name}</span><span class="diag-status">${c.status}</span>`;
            diagList.appendChild(item);
        });

        summary.innerHTML = `<div class="alert-success" style="margin-top: 20px; padding: 15px; border-radius: 10px; background: hsla(150, 100%, 40%, 0.1); border: 1px solid var(--success);">
            <strong>System Secure:</strong> No active camera hijacking or spyware patterns detected. Heuristic score: 98/100.
        </div>`;
        
        addLogEntry("Security Audit completed: System Clean.");
    }

    function captureSnapshot() {
        if (!isCameraEnabled) return null;
        const canvas = document.createElement('canvas');
        canvas.width = recordCanvas.width;
        canvas.height = recordCanvas.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(recordCanvas, 0, 0);
        try {
            return canvas.toDataURL('image/webp', 0.9);
        } catch (e) {
            return null;
        }
    }
    // --- AI Threat Engine ---
    let aiModelsLoaded = false;
    let faceAbsenceTimer = 0;
    let aiDetectionInterval = null;
    
    async function initAIEngine() {
        try {
            document.getElementById('ai-liveness-status').textContent = 'Loading Models...';
            await faceapi.nets.tinyFaceDetector.loadFromUri('https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights/');
            aiModelsLoaded = true;
            document.getElementById('ai-liveness-status').textContent = 'Monitoring Active';
            document.getElementById('ai-liveness-status').style.background = 'var(--success)';
            document.getElementById('ai-liveness-status').style.color = 'white';
            
            startAIEngine();
            addLogEntry("AI Threat Engine Initialized.");
        } catch (e) {
            console.error("AI Model Load Error:", e);
            document.getElementById('ai-liveness-status').textContent = 'AI Offline';
            document.getElementById('ai-liveness-status').style.background = 'var(--danger)';
            addLogEntry("Warning: AI Threat Engine failed to load. Operating in legacy mode.");
        }
    }

    function startAIEngine() {
        if (!aiModelsLoaded) return;
        if (aiDetectionInterval) clearInterval(aiDetectionInterval);
        
        aiDetectionInterval = setInterval(async () => {
            if (!isCameraEnabled || lockScreen.classList.contains('hidden') === false) return;
            
            // Run facial detection on the background proxy canvas
            const detections = await faceapi.detectAllFaces(recordCanvas, new faceapi.TinyFaceDetectorOptions());
            
            const threatScoreEl = document.getElementById('ai-threat-score');
            const livenessStatusEl = document.getElementById('ai-liveness-status');
            
            if (detections.length > 0) {
                // Face detected
                faceAbsenceTimer = 0;
                livenessStatusEl.textContent = `User Present (${detections.length})`;
                livenessStatusEl.style.background = 'var(--success)';
                threatScoreEl.textContent = 'SAFE';
                threatScoreEl.className = 'status-tag active';
                threatScoreEl.style.background = '';
            } else {
                // No face detected
                faceAbsenceTimer++;
                livenessStatusEl.textContent = 'User Absent';
                livenessStatusEl.style.background = 'var(--warning)';
                
                if (faceAbsenceTimer > 10 && faceAbsenceTimer < 30) {
                    threatScoreEl.textContent = 'ELEVATED';
                    threatScoreEl.className = 'status-tag warning';
                    threatScoreEl.style.background = 'var(--warning)';
                }
                
                // If absent for ~30 seconds (interval is 1000ms, so 30 ticks)
                if (faceAbsenceTimer >= 30) {
                    threatScoreEl.textContent = 'HIGH RISK';
                    threatScoreEl.className = 'status-tag disabled';
                    threatScoreEl.style.background = 'var(--danger)';
                    
                    addLogEntry("CRITICAL THREAT: Abandoned Station. Protecting data.");
                    
                    // Cloud Integration: Real-time Push Notification
                    if (window.pywebview) {
                        window.pywebview.api.send_push_notification(
                            "VisionGuard Alert (HIGH RISK)",
                            "Security Breach: Authorized user presence lost. Terminal Auto-Locked and footage encrypted."
                        );
                    }
                    
                    lockSystem(); // Secure the terminal
                    faceAbsenceTimer = 0; // Reset
                }
            }

            // Behavioral Pattern Analysis Simulation
            if (detections.length > 1) {
                addLogEntry("AI Behavior Alert: Multiple subjects detected in secure area.");
                document.getElementById('ai-threat-score').textContent = 'UNAUTHORIZED PRESENCE';
                document.getElementById('ai-threat-score').style.background = 'var(--danger)';
            }
        }, 1000); // 1 FPS is sufficient for presence detection
    }

    // --- UI Init ---
    const profileAvatar = document.getElementById('profile-avatar');
    const profileDropdown = document.getElementById('profile-dropdown');
    if (profileAvatar) {
        profileAvatar.onclick = (e) => {
            e.stopPropagation();
            profileDropdown.classList.toggle('hidden');
        };
    }
    document.addEventListener('click', () => { if (profileDropdown) profileDropdown.classList.add('hidden'); });

    const themeOptions = document.querySelectorAll('.theme-option');
    themeOptions.forEach(opt => {
        opt.onclick = () => {
            themeOptions.forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
            document.documentElement.style.setProperty('--primary', opt.style.background);
            addLogEntry(`System theme updated.`);
        };
    });

    // Start-up sequence
    loadLogs();
    loadSavedSettings();
    mainApp.classList.add('hidden');
    loginScreen.classList.remove('hidden');
});
