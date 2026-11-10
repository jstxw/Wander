// Wander's macOS helper. Reads the selected app window through the Accessibility API and draws a
// click-through highlight above one control. Electron main talks to it over stdin/stdout with one
// JSON object per line: requests {"id", "cmd", ...} get {"id", "ok", ...}; events are {"event", ...}.
// Element references and screen coordinates never leave this process; Node sees ids, roles and labels.
import AppKit
import ApplicationServices

// MARK: - Line protocol

let outputLock = NSLock()
func send(_ object: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(object),
          let data = try? JSONSerialization.data(withJSONObject: object) else { return }
    outputLock.lock()
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0A]))
    outputLock.unlock()
}

struct HelperError: Error { let code: String; let message: String }

// MARK: - Accessibility reading

func attribute(_ element: AXUIElement, _ name: String) -> AnyObject? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
    return value
}
func string(_ element: AXUIElement, _ name: String) -> String? {
    guard let text = attribute(element, name) as? String else { return nil }
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
}
func asElement(_ value: AnyObject?) -> AXUIElement? {
    guard let value, CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    return (value as! AXUIElement)
}
func children(_ element: AXUIElement) -> [AXUIElement] {
    (attribute(element, "AXChildren") as? [AXUIElement]) ?? []
}
func isAlive(_ element: AXUIElement) -> Bool {
    var value: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(element, "AXRole" as CFString, &value)
    return result == .success
}
/// Frame in Accessibility coordinates: origin at the top-left of the primary display, y grows downward.
func axFrame(_ element: AXUIElement) -> CGRect? {
    guard let position = attribute(element, "AXPosition"), let size = attribute(element, "AXSize"),
          CFGetTypeID(position) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero, extent = CGSize.zero
    guard AXValueGetValue(position as! AXValue, .cgPoint, &point),
          AXValueGetValue(size as! AXValue, .cgSize, &extent),
          point.x.isFinite, point.y.isFinite, extent.width > 1, extent.height > 1 else { return nil }
    return CGRect(origin: point, size: extent)
}

func label(of element: AXUIElement) -> String {
    for key in ["AXTitle", "AXDescription"] { if let text = string(element, key) { return text } }
    if let titleElement = asElement(attribute(element, "AXTitleUIElement")),
       let text = string(titleElement, "AXValue") ?? string(titleElement, "AXTitle") { return text }
    for key in ["AXHelp", "AXPlaceholderValue"] { if let text = string(element, key) { return text } }
    for child in children(element).prefix(4) where string(child, "AXRole") == "AXStaticText" {
        if let text = string(child, "AXValue") { return text }
    }
    return ""
}

let controlRoles: Set<String> = [
    "AXButton", "AXCheckBox", "AXRadioButton", "AXPopUpButton", "AXMenuButton", "AXTextField", "AXTextArea",
    "AXComboBox", "AXSlider", "AXIncrementor", "AXDisclosureTriangle", "AXLink", "AXColorWell",
    "AXMenuBarItem", "AXMenuItem", "AXSegmentedControl", "AXDateField", "AXStepper"
]
let textRoles: Set<String> = ["AXTextField", "AXTextArea", "AXComboBox", "AXDateField"]
let layoutRoles: Set<String> = ["AXOutline", "AXTable", "AXList", "AXBrowser", "AXGrid", "AXToolbar", "AXSheet", "AXTabGroup", "AXSplitGroup", "AXWebArea", "AXCollection"]
let bigContainers: Set<String> = ["AXOutline", "AXTable", "AXList", "AXBrowser", "AXGrid", "AXRow", "AXCollection", "AXWebArea"]
let maxControls = 150, maxTexts = 40, maxVisited = 3000, maxDepth = 25, containerChildCap = 30

struct Control { let id: String; let element: AXUIElement; let info: [String: Any] }
struct Reading {
    let window: AXUIElement; let windowTitle: String
    let controls: [Control]; let texts: [String]; let layout: [String]; let counts: [String: Int]; let truncated: Bool
    var fingerprint: String {
        controls.map { c in "\(c.info["role"] ?? "")|\(c.info["label"] ?? "")|\(c.info["value"] ?? "")|\(c.info["filled"] ?? "")" }.joined(separator: "\n")
            + "\n#" + counts.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: ",") + "\n#" + windowTitle
    }
}

func controlInfo(_ element: AXUIElement, role: String, id: String, area: String) -> [String: Any] {
    var info: [String: Any] = ["id": id, "role": role, "label": String(label(of: element).prefix(120)), "area": area]
    let subrole = string(element, "AXSubrole")
    if let subrole { info["subrole"] = subrole }
    if let identifier = string(element, "AXIdentifier"), identifier.count <= 60 { info["identifier"] = identifier }
    if let enabled = attribute(element, "AXEnabled") as? Bool, !enabled { info["enabled"] = false }
    if let focused = attribute(element, "AXFocused") as? Bool, focused { info["focused"] = true }
    // Never report typed text: a field's contents can be private. Only whether it is empty.
    if textRoles.contains(role) || subrole == "AXSecureTextField" {
        if subrole != "AXSecureTextField", let text = attribute(element, "AXValue") as? String { info["filled"] = !text.isEmpty }
    } else if ["AXCheckBox", "AXRadioButton", "AXMenuItem"].contains(role), let number = attribute(element, "AXValue") as? NSNumber {
        info["value"] = number.intValue != 0
    } else if role == "AXMenuItem", let mark = string(element, "AXMenuItemMarkChar") {
        info["value"] = !mark.isEmpty
    } else if ["AXPopUpButton", "AXComboBox", "AXMenuButton"].contains(role), let text = attribute(element, "AXValue") as? String {
        info["value"] = String(text.prefix(80))
    } else if ["AXSlider", "AXIncrementor", "AXStepper"].contains(role), let number = attribute(element, "AXValue") as? NSNumber {
        info["value"] = number.doubleValue
    }
    return info
}

func focusedWindow(pid: pid_t) -> AXUIElement? {
    let app = AXUIElementCreateApplication(pid)
    _ = AXUIElementSetMessagingTimeout(app, 1.0)
    if let window = asElement(attribute(app, "AXFocusedWindow")) { return window }
    if let window = asElement(attribute(app, "AXMainWindow")) { return window }
    return (attribute(app, "AXWindows") as? [AXUIElement])?.first
}

func read(pid: pid_t, window: AXUIElement) -> Reading {
    var controls: [Control] = [], texts: [String] = [], layout: [String] = [], counts: [String: Int] = [:]
    var visited = 0, truncated = false, nextId = 1
    func add(_ element: AXUIElement, role: String, area: String) {
        guard controls.count < maxControls else { truncated = true; return }
        guard axFrame(element) != nil else { return }
        let id = "c\(nextId)"; nextId += 1
        controls.append(Control(id: id, element: element, info: controlInfo(element, role: role, id: id, area: area)))
    }
    // Breadth first so toolbars and buttons near the top of the window come before deep list rows.
    var queue: [(AXUIElement, Int)] = [(window, 0)]
    var index = 0
    while index < queue.count {
        let (element, depth) = queue[index]; index += 1
        visited += 1
        if visited > maxVisited { truncated = true; break }
        let role = string(element, "AXRole") ?? ""
        if layoutRoles.contains(role) {
            counts[role, default: 0] += 1
            if !layout.contains(role) { layout.append(role) }
        }
        if controlRoles.contains(role) { add(element, role: role, area: "window") }
        else if role == "AXStaticText", texts.count < maxTexts, let text = string(element, "AXValue") { texts.append(String(text.prefix(200))) }
        guard depth < maxDepth else { continue }
        var kids = children(element)
        if bigContainers.contains(role), kids.count > containerChildCap { kids = Array(kids.prefix(containerChildCap)); truncated = true }
        for child in kids { queue.append((child, depth + 1)) }
    }
    // The menu bar, plus the items of any menu the user has open.
    let app = AXUIElementCreateApplication(pid)
    if let menuBar = asElement(attribute(app, "AXMenuBar")) {
        for item in children(menuBar) {
            guard string(item, "AXRole") == "AXMenuBarItem" else { continue }
            if label(of: item) == "Apple" { continue }
            add(item, role: "AXMenuBarItem", area: "menubar")
            // Closed menus still expose their items; only an open menu's items are on screen.
            guard attribute(item, "AXSelected") as? Bool == true else { continue }
            for menu in children(item) where string(menu, "AXRole") == "AXMenu" {
                for entry in children(menu) where string(entry, "AXRole") == "AXMenuItem" && !label(of: entry).isEmpty {
                    add(entry, role: "AXMenuItem", area: "menubar")
                }
            }
        }
    }
    return Reading(window: window, windowTitle: string(window, "AXTitle") ?? "", controls: controls, texts: texts, layout: layout, counts: counts, truncated: truncated)
}

// MARK: - Snapshots

final class Snapshot {
    let id: String; let pid: pid_t; let reading: Reading
    init(id: String, pid: pid_t, reading: Reading) { self.id = id; self.pid = pid; self.reading = reading }
    func element(_ controlId: String) -> AXUIElement? { reading.controls.first { $0.id == controlId }?.element }
}
var snapshots: [String: Snapshot] = [:]
var snapshotOrder: [String] = []
var snapshotCounter = 0

func runningApp(_ pid: pid_t) throws -> NSRunningApplication {
    guard let app = NSRunningApplication(processIdentifier: pid), !app.isTerminated else {
        throw HelperError(code: "appMissing", message: "That app is no longer running.")
    }
    return app
}

func takeSnapshot(pid: pid_t) throws -> Snapshot {
    guard AXIsProcessTrusted() else { throw HelperError(code: "permission", message: "Wander needs Accessibility access.") }
    let app = try runningApp(pid)
    guard let window = focusedWindow(pid: pid) else {
        throw HelperError(code: "noWindow", message: "\(app.localizedName ?? "This app") has no open window. Open one, then try again.")
    }
    snapshotCounter += 1
    let snapshot = Snapshot(id: "s\(snapshotCounter)", pid: pid, reading: read(pid: pid, window: window))
    snapshots[snapshot.id] = snapshot
    snapshotOrder.append(snapshot.id)
    while snapshotOrder.count > 6 { snapshots.removeValue(forKey: snapshotOrder.removeFirst()) }
    return snapshot
}

func describe(_ snapshot: Snapshot) -> [String: Any] {
    let app = NSRunningApplication(processIdentifier: snapshot.pid)
    return [
        "snapshotId": snapshot.id,
        "app": ["name": app?.localizedName ?? "", "bundleId": app?.bundleIdentifier ?? "", "pid": Int(snapshot.pid)],
        "window": ["title": snapshot.reading.windowTitle],
        "controls": snapshot.reading.controls.map { $0.info },
        "texts": snapshot.reading.texts,
        "layout": snapshot.reading.layout,
        "containerCounts": snapshot.reading.counts,
        "truncated": snapshot.reading.truncated
    ]
}

// MARK: - Overlay

/// Converts an Accessibility rectangle (top-left origin) to AppKit screen coordinates (bottom-left origin).
func cocoaRect(_ ax: CGRect) -> CGRect {
    let primaryHeight = NSScreen.screens.first?.frame.height ?? 0
    return CGRect(x: ax.minX, y: primaryHeight - ax.maxY, width: ax.width, height: ax.height)
}

final class HighlightView: NSView {
    var target: CGRect?          // in view coordinates; nil shows only the message
    var message = ""
    override var isFlipped: Bool { false }
    override func draw(_ dirtyRect: NSRect) {
        let hole = target?.insetBy(dx: -6, dy: -6)
        let shade = NSBezierPath(rect: bounds)
        if let hole { shade.append(NSBezierPath(roundedRect: hole, xRadius: 8, yRadius: 8)); shade.windingRule = .evenOdd }
        NSColor.black.withAlphaComponent(0.22).setFill()
        shade.fill()
        if let hole {
            let outer = NSBezierPath(roundedRect: hole.insetBy(dx: -3, dy: -3), xRadius: 10, yRadius: 10)
            outer.lineWidth = 3; NSColor.black.setStroke(); outer.stroke()
            let inner = NSBezierPath(roundedRect: hole, xRadius: 8, yRadius: 8)
            inner.lineWidth = 3; NSColor.white.setStroke(); inner.stroke()
        }
        guard !message.isEmpty else { return }
        let paragraph = NSMutableParagraphStyle(); paragraph.lineBreakMode = .byWordWrapping
        let text = NSAttributedString(string: message, attributes: [
            .font: NSFont.systemFont(ofSize: 15, weight: .medium), .foregroundColor: NSColor.white, .paragraphStyle: paragraph
        ])
        let maxWidth: CGFloat = 340, padding: CGFloat = 14
        let size = text.boundingRect(with: NSSize(width: maxWidth, height: 400), options: [.usesLineFragmentOrigin, .usesFontLeading]).size
        let bubbleSize = NSSize(width: ceil(size.width) + padding * 2, height: ceil(size.height) + padding * 2)
        var origin: NSPoint
        if let hole {
            origin = NSPoint(x: hole.minX, y: hole.minY - 16 - bubbleSize.height)            // below the target
            if origin.y < bounds.minY + 12 { origin.y = hole.maxY + 16 }                     // otherwise above it
        } else {
            origin = NSPoint(x: bounds.midX - bubbleSize.width / 2, y: bounds.maxY - 120 - bubbleSize.height)
        }
        origin.x = min(max(origin.x, bounds.minX + 12), bounds.maxX - bubbleSize.width - 12)
        origin.y = min(max(origin.y, bounds.minY + 12), bounds.maxY - bubbleSize.height - 12)
        let bubble = NSRect(origin: origin, size: bubbleSize)
        NSColor.black.withAlphaComponent(0.92).setFill()
        NSBezierPath(roundedRect: bubble, xRadius: 10, yRadius: 10).fill()
        NSColor.white.withAlphaComponent(0.85).setStroke()
        let border = NSBezierPath(roundedRect: bubble.insetBy(dx: 0.5, dy: 0.5), xRadius: 10, yRadius: 10); border.lineWidth = 1; border.stroke()
        text.draw(with: NSRect(x: bubble.minX + padding, y: bubble.minY + padding, width: ceil(size.width), height: ceil(size.height)), options: [.usesLineFragmentOrigin, .usesFontLeading])
    }
}

final class Overlay {
    let window: NSWindow
    let view = HighlightView()
    init() {
        window = NSWindow(contentRect: .zero, styleMask: .borderless, backing: .buffered, defer: false)
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.ignoresMouseEvents = true          // clicks go to the real control underneath
        window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.popUpMenuWindow)) + 1)
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        window.isReleasedWhenClosed = false
        window.contentView = view
    }
    /// `target` is in Accessibility coordinates; `anchor` picks the screen when there is no target.
    func show(target: CGRect?, anchor: CGRect, message: String) {
        let rect = cocoaRect(target ?? anchor)
        let mid = NSPoint(x: rect.midX, y: rect.midY)
        let screen = NSScreen.screens.first { $0.frame.contains(mid) } ?? NSScreen.main ?? NSScreen.screens[0]
        if window.frame != screen.frame { window.setFrame(screen.frame, display: false) }
        view.frame = NSRect(origin: .zero, size: screen.frame.size)
        view.target = target.map { _ in rect.offsetBy(dx: -screen.frame.minX, dy: -screen.frame.minY) }
        view.message = message
        view.needsDisplay = true
        window.orderFrontRegardless()
    }
    func hide() { window.orderOut(nil) }
}

// MARK: - Highlight tracking

final class Tracker {
    let snapshot: Snapshot; let target: AXUIElement?; let message: String
    let overlay: Overlay
    var timer: Timer?
    var lastFrame: CGRect?
    var baseline: String
    var pendingChange: String?
    var away = false
    var ticks = 0

    init(snapshot: Snapshot, target: AXUIElement?, message: String, overlay: Overlay) {
        self.snapshot = snapshot; self.target = target; self.message = message; self.overlay = overlay
        baseline = snapshot.reading.fingerprint
    }
    func start() {
        redraw()
        timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in self?.tick() }
        RunLoop.main.add(timer!, forMode: .common)
    }
    func stop() { timer?.invalidate(); timer = nil; overlay.hide() }

    func redraw() {
        guard let anchor = axFrame(snapshot.reading.window) else { return }
        if let target {
            guard let frame = axFrame(target) else { return }
            lastFrame = frame
            overlay.show(target: frame, anchor: anchor, message: message)
        } else {
            overlay.show(target: nil, anchor: anchor, message: message)
        }
    }

    func tick() {
        ticks += 1
        // Hide the highlight while the user is in another app; bring it back when they return.
        let frontmost = NSWorkspace.shared.frontmostApplication?.processIdentifier
        if frontmost != snapshot.pid {
            if !away { away = true; overlay.hide(); send(["event": "appSwitched"]) }
            return
        }
        if away { away = false; redraw(); send(["event": "appReturned"]) }

        if let target {
            guard isAlive(target), let frame = axFrame(target) else {
                finish(event: "targetLost"); return
            }
            if frame != lastFrame { lastFrame = frame; redraw() }
        }
        // Re-read the window every ~0.75 s. Report a change once it has been stable for one more read,
        // so a window that is still animating is not reported half-finished.
        guard ticks % 3 == 0 else { return }
        guard let window = focusedWindow(pid: snapshot.pid) else { finish(event: "windowChanged"); return }
        let current = read(pid: snapshot.pid, window: window).fingerprint
        let sameWindow = CFEqual(window, snapshot.reading.window)
        if current == baseline && sameWindow { pendingChange = nil; return }
        if pendingChange == current { finish(event: "windowChanged") } else { pendingChange = current }
    }

    func finish(event: String) {
        stop()
        if tracker === self { tracker = nil }
        send(["event": event, "snapshotId": snapshot.id])
    }
}

let overlay = Overlay()
var tracker: Tracker?

func highlight(snapshotId: String, controlId: String?, message: String) throws -> [String: Any] {
    guard let snapshot = snapshots[snapshotId] else { throw HelperError(code: "staleSnapshot", message: "The window has changed since Wander looked at it.") }
    let app = try runningApp(snapshot.pid)
    var target: AXUIElement?
    if let controlId, !controlId.isEmpty {
        guard let element = snapshot.element(controlId) else { throw HelperError(code: "unknownTarget", message: "That control is not part of this snapshot.") }
        target = element
    }
    // Verify the window and target are still current before drawing anything.
    guard isAlive(snapshot.reading.window) else { throw HelperError(code: "windowChanged", message: "The window closed or changed.") }
    if let target, !isAlive(target) || axFrame(target) == nil { throw HelperError(code: "targetMissing", message: "The control is no longer on screen.") }
    if !app.isActive { app.activate(options: []) }
    _ = AXUIElementPerformAction(snapshot.reading.window, "AXRaise" as CFString)
    tracker?.stop()
    let next = Tracker(snapshot: snapshot, target: target, message: message, overlay: overlay)
    tracker = next
    next.start()
    return [:]
}

func clear() { tracker?.stop(); tracker = nil }

// MARK: - Commands

func runningApps() -> [[String: Any]] {
    NSWorkspace.shared.runningApplications
        .filter { $0.activationPolicy == .regular && !$0.isTerminated }
        .map { ["pid": Int($0.processIdentifier), "name": $0.localizedName ?? "", "bundleId": $0.bundleIdentifier ?? "", "active": $0.isActive] }
}

func handle(_ line: String) {
    guard let data = line.data(using: .utf8),
          let request = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let id = request["id"] as? Int, let cmd = request["cmd"] as? String else { return }
    do {
        var result: [String: Any] = [:]
        switch cmd {
        case "permission":
            let prompt = request["prompt"] as? Bool ?? false
            let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: prompt] as CFDictionary
            result["trusted"] = AXIsProcessTrustedWithOptions(options)
        case "openAccessibilitySettings":
            if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") { NSWorkspace.shared.open(url) }
        case "listApps":
            result["apps"] = runningApps()
        case "snapshot":
            guard let pid = request["pid"] as? Int else { throw HelperError(code: "badRequest", message: "Missing pid.") }
            result = describe(try takeSnapshot(pid: pid_t(pid)))
        case "highlight":
            guard let snapshotId = request["snapshotId"] as? String else { throw HelperError(code: "badRequest", message: "Missing snapshot.") }
            result = try highlight(snapshotId: snapshotId, controlId: request["controlId"] as? String, message: String((request["message"] as? String ?? "").prefix(400)))
        case "clear":
            clear()
        case "quit":
            clear(); send(["id": id, "ok": true]); exit(0)
        default:
            throw HelperError(code: "badRequest", message: "Unknown command \(cmd).")
        }
        result["id"] = id; result["ok"] = true
        send(result)
    } catch let error as HelperError {
        send(["id": id, "ok": false, "code": error.code, "error": error.message])
    } catch {
        send(["id": id, "ok": false, "code": "internal", "error": "\(error)"])
    }
}

let application = NSApplication.shared
application.setActivationPolicy(.accessory)   // no Dock icon or menu bar of its own
Thread {
    while let line = readLine() { DispatchQueue.main.async { handle(line) } }
    DispatchQueue.main.async { clear(); exit(0) }   // Electron closed the pipe
}.start()
send(["event": "ready", "trusted": AXIsProcessTrusted()])
application.run()
