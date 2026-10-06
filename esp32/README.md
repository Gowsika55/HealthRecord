# ESP32 DevKit V1 + MFRC522 RFID Integration Guide

This guide explains how to connect and flash your **ESP32 DevKit V1** with the **MFRC522 (RC522) RFID reader** module, and integrate it directly with the EHR Blockchain system over a standard **USB cable**.

---

## 1. Hardware Requirements

| Item | Description | Quantity |
| :--- | :--- | :--- |
| **ESP32 DevKit V1** | 30-pin or 36-pin ESP-WROOM-32 development board | 1 |
| **MFRC522 (RC522)** | 13.56 MHz RFID Reader / Writer Module | 1 |
| **RFID Cards / Tags** | Standard 13.56 MHz Mifare Classic 1K Cards or Key Fobs | 1 or more |
| **USB Cable** | Micro-USB (or USB-C depending on ESP32 board) with data lines | 1 |
| **Jumper Wires** | Female-to-Female Dupont jumper wires | 7 |

---

## 2. Wiring & Pinout Diagram

> [!CAUTION]
> **CRITICAL VOLTAGE NOTICE:**
> The MFRC522 module operates on **3.3V**. Connect `3.3V (VCC)` on the MFRC522 **strictly** to the **`3V3`** pin on the ESP32.
> **DO NOT** connect to `5V` or `VIN` — doing so will permanently burn out the RFID module!

### Pin Connection Table

| MFRC522 Pin | ESP32 DevKit V1 Pin | Pin Function / Description |
| :--- | :--- | :--- |
| **3.3V (VCC)** | **3V3 (3.3V)** | Power Supply (3.3V only) |
| **RST** | **GPIO 22** | Module Reset |
| **GND** | **GND** | Ground |
| **IRQ** | *(Leave Disconnected)* | Interrupt Request (Not used) |
| **MISO** | **GPIO 19** | SPI Master In / Slave Out (VSPI) |
| **MOSI** | **GPIO 23** | SPI Master Out / Slave In (VSPI) |
| **SCK** | **GPIO 18** | SPI Clock (VSPI) |
| **SDA (SS)** | **GPIO 5** | SPI Chip / Slave Select |

---

## 3. Arduino IDE Setup & Flashing

### Step 1: Install Arduino IDE
If you do not have Arduino IDE installed, download it from [arduino.cc](https://www.arduino.cc/en/software) (Version 2.x recommended).

### Step 2: Install ESP32 Board Support
1. Open Arduino IDE.
2. Go to **File → Preferences**.
3. In **Additional Boards Manager URLs**, paste:
   ```
   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   ```
4. Click **OK**.
5. Open **Tools → Board → Boards Manager...**.
6. Search for `esp32` (by *Espressif Systems*) and click **Install**.

### Step 3: Install MFRC522 Library
1. Open **Sketch → Include Library → Manage Libraries...**.
2. Search for `MFRC522` (by *GithubCommunity*).
3. Click **Install**.

### Step 4: Open & Upload Firmware
1. Open the file:
   ```
   ehr_blockchain/esp32/rfid_reader_esp32/rfid_reader_esp32.ino
   ```
2. Connect your ESP32 to your PC using the USB cable.
3. Configure Tools menu:
   - **Board**: `DOIT ESP32 DEVKIT V1` (or generic `ESP32 Dev Module`)
   - **Port**: Select your ESP32 COM port (e.g., `COM3`, `COM4`, etc.)
   - **Upload Speed**: `115200` or `921600`
4. Click the **Upload** (Arrow) button.
   *(Note: If the upload hangs on `Connecting.......____`, press and hold the **BOOT** button on your ESP32 board until uploading starts).*

### Step 5: Verify in Serial Monitor
1. Open **Tools → Serial Monitor**.
2. Set baud rate to **`115200`**.
3. Tap an RFID card on the reader. You should see:
   ```json
   {"rfidUid":"B34A2C19"}
   [RFID SCAN] UID: B34A2C19 (4 bytes)
   ```

---

## 4. How It Works With the Doctor Dashboard

### Direct USB Connection (Web Serial API)
1. Open the EHR Web App in **Google Chrome** or **Microsoft Edge**.
2. Log in as an approved **Doctor**.
3. At the top of the dashboard, find the **ESP32 RFID Smart Card Scanner** panel.
4. Click **🔌 Connect ESP32 via USB**.
5. In the browser popup, select your ESP32 COM Port and click **Connect**.
6. The status badge will switch to **`✓ USB Serial Connected - Listening for Card Taps...`**.
7. Tap any RFID card on the MFRC522:
   - **If the card is registered to a patient**: The patient's profile (Name, Patient ID, DOB, Age, Blood Group, Wallet Address, and Medical Records) is immediately loaded on screen!
   - **If the card is unassigned**: A yellow prompt will display:
     `Unlinked RFID Card Detected: UID XXXXXXXX`.
     You can search for any patient and click **🔗 Link this Card** to bind it permanently to that patient.

### Simulation Mode (No Hardware Needed)
- If your ESP32 is not currently plugged in, you can test the entire workflow using the **Simulate Tap** box in the dashboard:
  1. Type any UID (e.g. `B34A2C19`).
  2. Click **⚡ Simulate Tap**.
  3. The system processes it identically to a physical hardware scan!

---

## 5. Security & Architecture Principles

- **No Medical Data Stored On Card**: The RFID card only stores its unique 4-byte or 7-byte factory UID. Zero sensitive patient data, diagnoses, or personal records are stored on the card itself.
- **Smart Contract & MongoDB Separation**:
  - The card UID acts purely as a secure physical indexing token to query MongoDB and retrieve the verified patient identity.
  - Medical diagnoses and cryptographic hashes remain strictly verified on the Ethereum smart contract on Sepolia Testnet.
- **Debounce Protection**: The ESP32 firmware contains a 2-second debounce filter so resting a card on the reader will not fire repeated requests.
