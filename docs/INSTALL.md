# Installing AETOS Office Assistant

AETOS Office Assistant is a Microsoft Word add-in. Unlike a normal add-in that
lives on a public website, this one runs entirely on your own machine: a small
local web server serves the task pane over trusted HTTPS on `localhost`, and a
launcher app registers it with Word.

Nothing is uploaded by the launcher. The only network traffic is between Word
and the model endpoint you configure yourself.

Both launchers are **unsigned preview builds**. Your operating system will warn
about them the first time. That warning is expected for an unsigned application;
there is no code-signing certificate in the current release.

## Windows

**Requirements:** Windows 10/11, .NET Framework 4.8 (included in current
Windows), and current Microsoft 365 Word with WebView2.

1. Download `AETOS-Office-Assistant-<version>.exe` from the
   [latest release](https://github.com/zzambia/aetos-office-assistant/releases).
2. Run it. SmartScreen may show *"Windows protected your PC"*; choose
   **More info → Run anyway**.
3. Click **Set up AETOS Office Assistant**.
4. Approve the certificate prompt if Windows asks. The launcher creates a
   localhost certificate and trusts its public part in your **current user**
   certificate store; the private key is protected with Windows DPAPI for your
   account.
5. Restart Word if it was already open.
6. In Word, open **Add-ins → My Add-ins** and select **AETOS Office Assistant**
   (the exact section label varies by Word version).

The launcher then runs in the tray beside the clock and can start automatically
when you sign in. It serves the add-in on `https://localhost:38473` and listens
on loopback only.

**Removing it:** right-click the tray icon and choose **Remove AETOS Office
Assistant setup**. That removes the Word registration, startup entry, Start menu
shortcut and the locally trusted certificate. The executable remains so you can
delete or reinstall it. Saved model connections stay in Word's browser storage.

More detail: [desktop/START_HERE.txt](../desktop/START_HERE.txt).

## macOS

**Requirements:** a current macOS, current Microsoft 365 Word, and Node.js 22
only if you build the app yourself.

1. Download `AETOS-Office-Assistant-<version>-macos.zip` from the
   [latest release](https://github.com/zzambia/aetos-office-assistant/releases).
2. Unzip it and move **AETOS Office Assistant.app** to Applications.
3. **Right-click the app and choose Open**, then confirm. A normal double-click
   is blocked because the app is not notarized.
4. On first launch the app creates and trusts a localhost certificate and copies
   its manifest into Word's add-in folder. macOS may ask you to approve the
   keychain change, and may require granting the app **Full Disk Access** in
   *System Settings → Privacy & Security*.
5. Quit Word completely (Cmd+Q), reopen it, and choose **Insert → Add-ins →
   AETOS Office Assistant**.

The app then lives in the menu bar: open Word, toggle start at login, remove the
setup, or quit. It serves the add-in on `https://localhost:38473` and listens on
loopback only.

If the add-in does not appear, or macOS blocks access to Word's container, see
[docs/MAC.md](MAC.md) for the manual `wef` folder steps.

## Alternative: run from source (developers)

If you would rather not use a launcher, you can build the web assets and serve
them yourself with a certificate you trust.

```sh
npm run build
npm start           # https://localhost:3000
```

`npm start` needs a trusted localhost certificate:

```sh
npm run mac:cert    # macOS: create and trust one in your login keychain
export AETOS_TLS_CERT=/path/localhost-cert.pem
export AETOS_TLS_KEY=/path/localhost-key.pem
```

An Office add-in requires an HTTPS origin that Word's browser engine trusts. Do
not disable browser or Office security checks.

Then sideload the add-in into Word:

- **macOS:** `npm run mac:sideload` copies `dist/manifest.xml` into Word's `wef`
  folder.
- **Windows:** use an Office trusted shared-folder catalog containing
  `dist/manifest.xml`, or your organization's deployment mechanism.
- **Word for the web:** upload `dist/manifest.xml` through the Office Add-ins
  upload command, where your tenant permits it.

Sideloading instructions in Microsoft's documentation:

- [Windows sideloading](https://learn.microsoft.com/en-us/office/dev/add-ins/testing/create-a-network-shared-folder-catalog-for-task-pane-and-content-add-ins)
- [Mac sideloading](https://learn.microsoft.com/en-us/office/dev/add-ins/testing/sideload-an-office-add-in-on-mac)
- [Web sideloading](https://learn.microsoft.com/en-us/office/dev/add-ins/testing/sideload-office-add-ins-for-testing)

## After installing

Open **Model connection** in the task pane and save at least one connection
before generating. See [MODELS.md](MODELS.md).

## Troubleshooting

| Symptom | What to check |
|---|---|
| Word does not list the add-in | Restart Word; confirm the launcher is running (tray or menu bar). |
| Pane opens but says it cannot reach the server | The launcher is not running, or its port is in use. |
| Certificate warning in the pane | Re-run setup to recreate and trust the certificate. |
| macOS refuses to open the app | Use right-click → Open, or clear the quarantine flag. |
| macOS blocks access to Word's folder | Grant Full Disk Access, or copy the manifest manually ([MAC.md](MAC.md)). |
| "This add-in requires WordApi 1.3…" | Word or the OS is too old, or the pane is open outside Word. |
