from PIL import Image
import os

png_path = r'C:\Users\deven\.gemini\antigravity\brain\e5e0d99e-f117-4579-b65f-c04d3e5ffd5f\visionguard_icon_1774683377740.png'
ico_path = r'c:\WEB CAM SPYWARE\visionguard.ico'

try:
    img = Image.open(png_path)
    # Define standard icon sizes
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    img.save(ico_path, format='ICO', sizes=sizes)
    print(f"Icon saved successfully at: {ico_path}")
except Exception as e:
    print(f"Error converting icon: {e}")
