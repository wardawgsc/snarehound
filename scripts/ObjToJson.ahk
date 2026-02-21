; ObjToJson for AHK v2
ObjToJson(obj) {
    json := "{"
    for k, v in obj {
        if IsObject(v)
            json .= '"' k '":' ObjToJson(v) ','
        else if IsNumber(v)
            json .= '"' k '":' v ','
        else
            json .= '"' k '":"' v '",' 
    }
    if StrLen(json) > 1
        json := SubStr(json, 1, -1)
    json .= "}"
    return json
}
