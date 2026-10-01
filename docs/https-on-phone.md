# HTTPS on the phone (mkcert, one origin, one certificate)

WebXR, camera, motion sensors and speech recognition only work in a **secure context**. The app and its API/WebSocket are served from one origin
(`https://<laptop-ip>:8080`), so the phone needs to trust exactly one certificate.

## 1. Laptop (Windows), once

```powershell
winget install FiloSottile.mkcert      # then open a NEW terminal so PATH updates
npm run certs                          # runs `mkcert -install`, creates certs/key.pem + certs/cert.pem
```

`npm run certs` covers `localhost` and the laptop's current LAN IPv4 addresses and prints the path of `rootCA.pem`
(normally `%LOCALAPPDATA%\mkcert\rootCA.pem`; `mkcert -CAROOT` shows the folder). **Re-run it whenever the laptop's LAN IP changes**
(new Wi-Fi, DHCP lease change), otherwise Chrome shows a name-mismatch warning.

Without `certs/`, `npm run dev` falls back to a throwaway self-signed certificate. That is fine for a quick look at the pages on the
laptop, but on the phone every visit needs "Advanced → Proceed", and WebSocket/camera features may be blocked. Use mkcert for real testing.

## 2. Phone (Android / Chrome), once

1. Copy `rootCA.pem` to the phone: USB cable, `adb push "%LOCALAPPDATA%\mkcert\rootCA.pem" /sdcard/Download/` (phone has USB debugging on), or Google Drive / email to yourself.
2. Rename it to `rootCA.crt` if the installer does not list `.pem`.
3. Settings → Security and privacy → **More security settings** (wording varies: "Encryption & credentials") → **Install a certificate** → **CA certificate** → "Install anyway" → pick the file.
   On POCO / MIUI / HyperOS: Settings → Passwords & security → Privacy → … → Encryption & credentials → Install a certificate → CA certificate.
4. A screen lock (PIN/pattern) must be set, otherwise Android refuses to install it.
5. Fully close and reopen Chrome.

**Never share `rootCA-key.pem`.** Only `rootCA.pem` goes to the phone. Remove the CA from the phone after the project if you like
(Settings → Encryption & credentials → User credentials).

## 3. Run

```powershell
npm run dev:lan
```

prints `https://<lan-ip>:8080` and a QR code; scan it with the phone camera or type the URL. Phone and laptop must be on the same
network and the laptop firewall must allow inbound TCP 8080 (Windows asks the first time; choose "Private networks"). Corporate Wi-Fi
with "client isolation" blocks phone↔laptop traffic: use a phone hotspot or a small travel router in that case.

Production/demo mode (serves `dist/` over HTTPS with the same API + WebSocket): `npm run build && npm run serve` (port 8443, `PORT=` to change).

## Checks and troubleshooting

- Open `https://<lan-ip>:8080/spikes`: the page should say "Secure context" in green and Chrome should show a closed padlock.
- Warning "Your connection is not private" → the CA is not installed, or the IP changed (re-run `npm run certs`, re-launch).
- Page loads but WebXR/camera blocked → you are on `http://`, or opened an IP not in the certificate.
- Cannot reach the laptop at all → firewall / client isolation (above). `curl -k https://<lan-ip>:8080/api/health` from another machine tests it.
- Fallback with no certificate work: USB-debug the phone, run `adb reverse tcp:8080 tcp:8080` and open `https://localhost:8080` on the phone
  (`localhost` counts as secure even for plain HTTP, but the mkcert/self-signed cert still applies to https). Chrome `chrome://inspect` shows the phone's console.
