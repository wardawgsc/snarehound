; AHK v2 HTTP server for local sound trigger
#Requires AutoHotkey v2.0+

; Requires: https://github.com/ahkscript/AHKsock (or similar HTTP server lib)
; Download AHKsock.ahk and place in the same directory as this script.
#Include %A_ScriptDir%\AHKsock.ahk

PORT := 29345 ; You can change this port if needed

; Load your sound config as in GameLogReader.ahk
configFile := A_ScriptDir "\snare_reader_config.ini"
defaultSound := "BEEP"
global alertSound := defaultSound
alertSound := IniRead(configFile, "Paths", "SoundFile", defaultSound)

; Start HTTP server
AHKsock_Listen(PORT, "OnRequest")
MsgBox "AHK HTTP server running on port " PORT

OnRequest(socket, address, port, data) {
    global alertSound
    if InStr(data, "GET /play-alert") {
        PlayAlert()
        response := "HTTP/1.1 200 OK`r`nContent-Type: text/plain`r`n`r`nOK"
        AHKsock_Send(socket, response)
    } else {
        response := "HTTP/1.1 404 Not Found`r`nContent-Type: text/plain`r`n`r`nNot Found"
        AHKsock_Send(socket, response)
    }
    AHKsock_Close(socket)
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
