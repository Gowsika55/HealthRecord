/*
 ============================================================================
  EHR Blockchain System - ESP32 DevKit V1 + MFRC522 RFID Card Reader
 ============================================================================
  Hardware Requirements:
    1. ESP32 DevKit V1 (30-pin or 36-pin)
    2. MFRC522 (RC522) RFID Reader Module
    3. 13.56MHz RFID Mifare 1K Card / Key Fob
    4. Micro-USB (or Type-C) Data Cable
    5. Jumper Wires (Female-to-Female)

  CRITICAL WIRING NOTICE:
    Power the MFRC522 with 3.3V ONLY! Connecting to 5V or VIN will permanently
    damage the MFRC522 module.

  ESP32 DevKit V1 to MFRC522 SPI Pinout:
    -----------------------------------------------------
    MFRC522 Pin     ESP32 DevKit V1 Pin     Description
    -----------------------------------------------------
    3.3V (VCC)  --> 3V3 (3.3V)              Power (NOT 5V/VIN!)
    RST         --> GPIO 22                 Reset Pin
    GND         --> GND                     Ground
    IRQ         --> (Unconnected)           Not needed
    MISO        --> GPIO 19                 SPI MISO (VSPI)
    MOSI        --> GPIO 23                 SPI MOSI (VSPI)
    SCK         --> GPIO 18                 SPI Clock (VSPI)
    SDA (SS)    --> GPIO 5                  SPI Slave Select
    -----------------------------------------------------

  Features:
    - Direct USB Serial output formatted as JSON {"rfidUid":"..."} for React Web Serial API
    - Automatic card debounce (prevents multiple scans if card is held on reader)
    - Visual feedback using onboard LED (GPIO 2)
    - Optional Wi-Fi HTTP direct POST to Express backend (if Wi-Fi credentials configured)
 ============================================================================
*/

#include <SPI.h>
#include <MFRC522.h>
#include <WiFi.h>
#include <HTTPClient.h>

// -------------------------------------------------------------
// Pin Definitions (Standard ESP32 VSPI)
// -------------------------------------------------------------
#define SS_PIN    5    // ESP32 GPIO 5  -> MFRC522 SDA (SS)
#define RST_PIN   22   // ESP32 GPIO 22 -> MFRC522 RST
#define LED_PIN   2    // ESP32 Onboard LED (GPIO 2)

// -------------------------------------------------------------
// Optional Wi-Fi Configuration
// (Leave WIFI_SSID empty "" to use pure USB Serial mode)
// -------------------------------------------------------------
const char* WIFI_SSID     = "";                   // Enter Wi-Fi Name (optional)
const char* WIFI_PASSWORD = "";                   // Enter Wi-Fi Password (optional)
const char* BACKEND_URL   = "http://192.168.1.100:5000/api/rfid/scan"; // Change to your PC's LAN IP if using Wi-Fi

// -------------------------------------------------------------
// MFRC522 Instance
// -------------------------------------------------------------
MFRC522 rfid(SS_PIN, RST_PIN);

// Debounce timer: prevent duplicate scans within this window
unsigned long lastScanTime = 0;
const unsigned long DEBOUNCE_DELAY_MS = 2000;
String lastScannedUid = "";

// -------------------------------------------------------------
// Function Prototypes
// -------------------------------------------------------------
void sendRfidOverWifi(String uid);
void blinkLed(int times, int delayMs);

void setup() {
  // Initialize Serial Monitor / USB Serial at 115200 baud
  Serial.begin(115200);
  delay(1000);

  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  Serial.println();
  Serial.println("==================================================");
  Serial.println(" EHR Blockchain - ESP32 RFID Reader Initializing ");
  Serial.println("==================================================");

  // Initialize SPI bus with standard ESP32 VSPI pins:
  // SCK = 18, MISO = 19, MOSI = 23, SS = 5
  SPI.begin(18, 19, 23, SS_PIN);

  // Initialize MFRC522 RFID reader
  rfid.PCD_Init();
  delay(100);

  // Verify MFRC522 connection
  byte v = rfid.PCD_ReadRegister(rfid.VersionReg);
  Serial.print("MFRC522 Firmware Version: 0x");
  Serial.println(v, HEX);

  if (v == 0x00 || v == 0xFF) {
    Serial.println("ERROR: MFRC522 reader NOT found!");
    Serial.println("Check 3.3V power, GND, and SPI jumper wires.");
    // Fast continuous blink to indicate hardware error
    for (int i = 0; i < 6; i++) {
      digitalWrite(LED_PIN, HIGH);
      delay(100);
      digitalWrite(LED_PIN, LOW);
      delay(100);
    }
  } else {
    Serial.println("SUCCESS: MFRC522 RFID Reader Ready.");
    Serial.println("Ready to scan 13.56MHz RFID cards.");
    blinkLed(2, 150);
  }

  // Connect to Wi-Fi if credentials are provided
  if (strlen(WIFI_SSID) > 0) {
    Serial.print("Connecting to Wi-Fi: ");
    Serial.println(WIFI_SSID);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 20) {
      delay(500);
      Serial.print(".");
      attempts++;
    }
    Serial.println();

    if (WiFi.status() == WL_CONNECTED) {
      Serial.print("Wi-Fi Connected! IP Address: ");
      Serial.println(WiFi.localIP());
      blinkLed(3, 100);
    } else {
      Serial.println("Wi-Fi connection timed out. Falling back to USB Serial mode.");
    }
  } else {
    Serial.println("Operating Mode: Pure USB Serial Mode (Web Serial API).");
  }

  Serial.println("==================================================");
  Serial.println("Tap an RFID card or key fob on the reader...");
  Serial.println("==================================================");
}

void loop() {
  // Check if a new card is present on the reader
  if (!rfid.PICC_IsNewCardPresent()) {
    delay(50);
    return;
  }

  // Attempt to read the card serial
  if (!rfid.PICC_ReadCardSerial()) {
    delay(50);
    return;
  }

  // Convert UID bytes to uppercase Hexadecimal String
  String cardUid = "";
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) {
      cardUid += "0";
    }
    cardUid += String(rfid.uid.uidByte[i], HEX);
  }
  cardUid.toUpperCase();

  // Debounce check: Avoid spamming if card stays on reader
  unsigned long now = millis();
  if (cardUid == lastScannedUid && (now - lastScanTime) < DEBOUNCE_DELAY_MS) {
    // Halt card and exit
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
    return;
  }

  lastScanTime = now;
  lastScannedUid = cardUid;

  // Visual feedback: Turn on LED during scan
  digitalWrite(LED_PIN, HIGH);

  // 1. Output clean JSON to USB Serial for React Web Serial API
  // Format: {"rfidUid":"B34A2C19"}
  Serial.print("{\"rfidUid\":\"");
  Serial.print(cardUid);
  Serial.println("\"}");

  // Also print human-readable log (for Arduino Serial Monitor debugging)
  Serial.print("[RFID SCAN] UID: ");
  Serial.print(cardUid);
  Serial.print(" (");
  Serial.print(rfid.uid.size);
  Serial.println(" bytes)");

  // 2. Optional: If Wi-Fi is connected, send HTTP POST to Express backend
  if (WiFi.status() == WL_CONNECTED && strlen(BACKEND_URL) > 0) {
    sendRfidOverWifi(cardUid);
  }

  // Visual feedback: Turn off LED after scan
  delay(150);
  digitalWrite(LED_PIN, LOW);

  // Halt PICC to stop re-reading until removed
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();

  delay(200);
}

// -------------------------------------------------------------
// Optional Wi-Fi HTTP POST to Backend
// -------------------------------------------------------------
void sendRfidOverWifi(String uid) {
  HTTPClient http;
  http.begin(BACKEND_URL);
  http.addHeader("Content-Type", "application/json");

  String payload = "{\"rfidUid\":\"" + uid + "\"}";
  int httpResponseCode = http.POST(payload);

  if (httpResponseCode > 0) {
    Serial.print("[Wi-Fi POST] Server Response: ");
    Serial.println(httpResponseCode);
    String response = http.getString();
    Serial.print("[Wi-Fi POST] Payload: ");
    Serial.println(response);
  } else {
    Serial.print("[Wi-Fi POST] Failed. Error: ");
    Serial.println(http.errorToString(httpResponseCode).c_str());
  }

  http.end();
}

// -------------------------------------------------------------
// Helper: Blink Onboard LED
// -------------------------------------------------------------
void blinkLed(int times, int delayMs) {
  for (int i = 0; i < times; i++) {
    digitalWrite(LED_PIN, HIGH);
    delay(delayMs);
    digitalWrite(LED_PIN, LOW);
    if (i < times - 1) delay(delayMs);
  }
}
