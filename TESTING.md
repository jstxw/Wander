# Testing Wander for macOS

This is an early test build. It runs on Apple Silicon Macs with macOS 13 or later.

## 1. Get the app

Use one of these:

- **Download the build.** Open the repository's **Actions** tab on GitHub, pick the latest **Mac build** run on the `mac-app` branch, and download the **Wander-mac-arm64** artifact. Unzip it to get `Wander-….dmg`.
- **Build it yourself.** Install [Node.js 22](https://nodejs.org) and the Xcode Command Line Tools (`xcode-select --install`), then run:

  ```sh
  git clone <repo> && cd Wander && git checkout mac-app
  npm run build:mac
  ```

  The DMG is written to `out/make/`.

## 2. Install and open it

1. Open the DMG and drag **Wander** to **Applications**.
2. Open Wander from Applications. This build is not signed with an Apple Developer ID, so macOS blocks it the first time.
3. Open **System Settings → Privacy & Security**, scroll down, and click **Open Anyway** next to the message about Wander. Confirm with your password.

If macOS says the app is damaged, run this once in Terminal and open it again:

```sh
xattr -dr com.apple.quarantine /Applications/Wander.app
```

## 3. Allow Accessibility access

Wander's window shows **Allow Accessibility access** until you grant it.

1. Click **Open System Settings**.
2. Turn on **Wander** under **Privacy & Security → Accessibility**.
3. Go back to Wander and click **Check again**.

Every new build of an unsigned app counts as a new app to macOS. After installing a newer build, remove the old Wander entry from the Accessibility list and allow it again.

## 4. What to test

Work through these in order. Each one matches a milestone in the plan.

### Milestone 2: Finder demo (no API keys needed)

1. In Finder, set a window to Icon view (**View → as Icons**).
2. In Wander, click **Try the Finder demo**.
3. Expected: Finder comes to the front, the screen dims slightly, and a black-and-white ring outlines the **List view** button with an instruction under it. If the toolbar is too narrow to show the view buttons, Wander points at the **View** menu instead, then at **as List**.
4. Click the highlighted control yourself.
5. Expected: the highlight disappears and Wander says Finder now shows List view.

Also try:
- Switching to another app while the highlight is showing. It should hide, then come back when you return to Finder.
- Moving or resizing the Finder window. The ring should follow the button.

### Milestone 1: Web guidance from the app (needs keys)

1. Click **Open Settings in Chrome**, enter an OpenAI key and a Steel key, and click **Save keys locally**.
2. Click **Get the Chrome extension**. In Chrome, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose the folder Finder highlights.
3. In the Settings page, click **Pair extension**.
4. Open any ordinary website, click the black Wander button on the right of the page, and ask something like "Show me how to search this website."
5. Expected: Chrome highlights one control on the page. No Terminal window is needed.

### Milestone 3: Guide a Mac app (needs an OpenAI key)

1. In Wander, choose an app under **Guide this Mac app**, for example Finder, Notes, or TextEdit.
2. Type a question, such as "Show me how to make a new folder", and click **Guide me**.
3. Expected: the app comes to the front with one control highlighted and an instruction. Do the step yourself, and Wander should move on to the next step or say you are done.
4. Click **Check my progress** if Wander does not notice your change, and **Stop** to end the lesson.

## 5. What to send back

For anything that goes wrong, note:

- what you clicked and what you expected
- the exact message Wander showed
- a screenshot, especially if the highlight is in the wrong place (say whether you use more than one display)
- your Mac model and macOS version

Logs: quit Wander, then run `/Applications/Wander.app/Contents/MacOS/Wander` in Terminal, repeat the problem, and copy what Terminal prints.

Keys and state are stored in `~/Library/Application Support/Wander/`. Delete that folder to start fresh.
