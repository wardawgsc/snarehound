

#Include %A_ScriptDir%\ObjToJson.ahk
; SnareHound Game.log Reader (System Tray)
; AutoHotkey v2

backendUrl := "https://snarehound-backend-86hs.onrender.com/"
agentToken := "dev-agent-token"
agentId := "dev-local"

defaultLogPath := "C:\Program Files\Roberts Space Industries\StarCitizen\LIVE\Game.log"
defaultSound := "BEEP" ; Use system beep by default
configFile := A_ScriptDir "\snare_reader_config.ini"
iconPath := A_ScriptDir "\snarebears.png"

global logPath := defaultLogPath
global alertSound := defaultSound

logPath := IniRead(configFile, "Paths", "LogFile", defaultLogPath)
alertSound := IniRead(configFile, "Paths", "SoundFile", defaultSound)

A_TrayMenu.Add("Change Log Path", ChangeLogPath)
A_TrayMenu.Add("Change Alert Sound", ChangeAlertSound)
A_TrayMenu.Add("Quit", (*) => ExitApp())

MsgBox "SnareHound Game.log Reader is now running in the system tray.`n`nRight-click the tray icon for options:`n- Change Log Path`n- Change Alert Sound`n- Quit`n`nThe tray icon uses snarebears.png. Default log path is:`n" logPath, "SnareHound Game.log Reader", 64

SetTimer(WatchLog, 1000)

WatchLog() {
	; ...existing code...
}

SendLogEvent(eventType, eventData := {}) {
    global backendUrl, agentToken, agentId
    try {
        req := ComObject("WinHttp.WinHttpRequest.5.1")
        req.Open("POST", backendUrl "v1/agent/events", false)
        req.SetRequestHeader("Content-Type", "application/json")
        req.SetRequestHeader("x-agent-token", agentToken)
        ; Build event object
        event := {
            type: eventType,
            timestamp: FormatTime(A_Now, "yyyy-MM-dd'T'HH:mm:ss'Z'")
        }
        ; Merge extra eventData fields
        for k, v in eventData
            event[k] := v
        payload := ObjToJson({
            agentId: agentId,
            event: event
        })
        req.Send(payload)
        TrayTip("Log event sent to backend.")
    } catch {
        TrayTip("Failed to send log event.")
    }
}

PlayAlert() {
    global alertSound
    if alertSound = "BEEP" {
        SoundBeep(750, 300)
    } else if FileExist(alertSound) {
        SoundPlay(alertSound, 1)
    } else {
        SoundBeep(750, 300)
    }
}

; Expose PlayAlert for JS integration
global SnareHoundAHK := { playAlert: PlayAlert }

; Handler for TEST_ALARM from web app
TestAlarm() {
    PlayAlert()
    SendLogEvent("ship.detected", { shipName: "TEST_ALARM", source: "webapp", note: "manual test alarm" })
}

ChangeLogPath(*) {
    global logPath
    newPath := FileSelect(3, logPath, "Select game.log", "Log Files (*.log)")
    if newPath {
        logPath := newPath
        IniWrite(logPath, configFile, "Paths", "LogFile")
    }
}

ChangeAlertSound(*) {
    global alertSound
    newSound := FileSelect(3, alertSound, "Select alert sound (WAV/MP3) or Cancel for system beep", "Audio Files (*.wav;*.mp3)")
    if newSound {
        alertSound := newSound
        IniWrite(alertSound, configFile, "Paths", "SoundFile")
    }
}
