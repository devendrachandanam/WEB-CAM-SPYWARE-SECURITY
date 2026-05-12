import os
import sys
import webview
import json

# Bypass camera/mic permission prompts and allow autoplay without user gesture
os.environ['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS'] = '--use-fake-ui-for-media-stream --autoplay-policy=no-user-gesture-required'
import smtplib
import base64
import datetime
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.image import MIMEImage

import json
import os
from datetime import datetime

class Api:
    def __init__(self):
        self.config_path = os.path.join(os.getcwd(), 'visionguard_config.json')
        self.recordings_base = os.path.join(os.getcwd(), 'recordings')

    def save_recording(self, image_data, event_type, extension=".png"):
        try:
            # Create Folder: recordings/DD-Month-YYYY (e.g. 01-May-2026)
            now = datetime.now()
            date_str = now.strftime('%d-%b-%Y')
            day_dir = os.path.join(self.recordings_base, date_str)
            
            if not os.path.exists(day_dir):
                os.makedirs(day_dir)

            # Generate filename with timestamp
            filename = f"{event_type}_{now.strftime('%H-%M-%S')}{extension}"
            filepath = os.path.join(day_dir, filename)

            # Decode and save
            header, encoded = image_data.split(",", 1)
            with open(filepath, "wb") as f:
                f.write(base64.b64decode(encoded))
            
            return {"success": True, "path": filepath}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def save_settings(self, settings):
        try:
            with open(self.config_path, 'w') as f:
                json.dump(settings, f)
            return {"success": True}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def load_settings(self):
        try:
            if os.path.exists(self.config_path):
                with open(self.config_path, 'r') as f:
                    return json.load(f)
            return {}
        except Exception as e:
            return {}

    def send_email(self, smtp_settings, receiver_email, subject, body, image_data=None):
        """Sends an email notification with optimized SMTP connection for speed."""
        try:
            host = smtp_settings.get('host', '').strip() or 'smtp.gmail.com'
            port = int(str(smtp_settings.get('port', 587)).strip())
            user = smtp_settings.get('user', '').strip()
            password = smtp_settings.get('pass', '').strip()
            
            msg = MIMEMultipart()
            msg['From'] = user
            msg['To'] = receiver_email
            msg['Subject'] = subject
            msg.attach(MIMEText(body, 'plain'))
            
            if image_data and ',' in image_data:
                try:
                    header, encoded = image_data.split(",", 1)
                    img_data = base64.b64decode(encoded)
                    image = MIMEImage(img_data, name="intruder_alert.webp")
                    msg.attach(image)
                except Exception as img_err:
                    print(f"Error attaching image: {img_err}")
            
            # High-Speed SMTP Dispatch with explicit handshakes
            if port == 465:
                server = smtplib.SMTP_SSL(host, port, timeout=10)
                server.ehlo()
            else:
                server = smtplib.SMTP(host, port, timeout=10)
                server.ehlo()
                server.starttls()
                server.ehlo()
            
            server.login(user, password)
            server.send_message(msg)
            server.quit()
            return {"success": True, "message": "Access code dispatched successfully."}
        except Exception as e:
            print(f"SMTP Error: {str(e)}")
            return {"success": False, "message": f"Connection Error: {str(e)}"}

    def send_push_notification(self, title, message):
        """Sends a real-time mobile push notification via free cloud webhook (ntfy.sh)"""
        import urllib.request
        import urllib.parse
        try:
            # We use a secure, unique topic name based on the system's MAC address or a static hash
            # For this demo, we'll use a static topic 'visionguard_sec_alerts_883'
            topic = "visionguard_sec_alerts_883"
            url = f"https://ntfy.sh/{topic}"
            
            req = urllib.request.Request(url, data=message.encode('utf-8'), method='POST')
            req.add_header("Title", title)
            req.add_header("Priority", "high")
            req.add_header("Tags", "rotating_light,skull")
            
            urllib.request.urlopen(req, timeout=5)
            return {"success": True, "topic": topic}
        except Exception as e:
            print(f"Push Notification Error: {str(e)}")
            return {"success": False, "message": str(e)}

    def save_video(self, video_data_base64):
        """Saves a recorded video chunk to a folder named by the current date."""
        try:
            # Ensure the base recordings directory exists
            recordings_root = os.path.join(os.getcwd(), "recordings")
            if not os.path.exists(recordings_root):
                os.makedirs(recordings_root)

            # Create daily subfolder recordings/<YYYY-MM-DD>
            now = datetime.datetime.now()
            date_folder = now.strftime("%Y-%m-%d")
            save_path = os.path.join(recordings_root, date_folder)
            
            if not os.path.exists(save_path):
                os.makedirs(save_path)

            # Generate filename with timestamp (HH-MM-SS.webm)
            filename = now.strftime("%H-%M-%S") + ".webm"
            full_path = os.path.join(save_path, filename)

            # Decode the base64 data and write to file
            if "," in video_data_base64:
                header, encoded = video_data_base64.split(",", 1)
                file_data = base64.b64decode(encoded)
                with open(full_path, "wb") as f:
                    f.write(file_data)
                
                print(f"Saved recording: {full_path}")
                return {"success": True, "filename": filename, "path": full_path}
            return {"success": False, "message": "Invalid video data format."}
        except Exception as e:
            print(f"File Save Error: {str(e)}")
            return {"success": False, "message": f"Failed to save video: {str(e)}"}

    def open_recordings_folder(self):
        """Opens the recordings directory in the OS file explorer."""
        try:
            path = os.path.join(os.getcwd(), "recordings")
            if not os.path.exists(path):
                os.makedirs(path)
            
            if sys.platform == 'win32':
                os.startfile(path)
            elif sys.platform == 'darwin':
                import subprocess
                subprocess.Popen(['open', path])
            else:
                import subprocess
                subprocess.Popen(['xdg-open', path])
            return {"success": True, "message": "Folder opened."}
        except Exception as e:
            return {"success": False, "message": f"Error: {str(e)}"}

def get_resource_path(relative_path):
    """ Get absolute path to resource, works for dev and for PyInstaller """
    try:
        # PyInstaller creates a temp folder and stores path in _MEIPASS
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.abspath(".")

    return os.path.join(base_path, relative_path)

if __name__ == '__main__':
    # Initialize the API
    api = Api()
    
    # Define the directory where the resources are located
    # By default, pywebview 3.x+ with http_server=True serves the current directory.
    # We will use the filename 'index.html' directly.
    
    # Create the webview window pointing to index.html on the internal server
    window = webview.create_window(
        'VisionGuard Security System', 
        get_resource_path('index.html'),
        js_api=api,
        width=1200,
        height=800,
        resizable=True,
        min_size=(800, 600)
    )
    
    # Start the application with an internal HTTP server to allow getUserMedia
    # The 'http_server=True' flag resolves "Secure Context" requirements for camera/mic access
    webview.start(http_server=True, private_mode=False)
