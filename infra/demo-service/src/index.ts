import * as http from "node:http";
import { registerVisit } from "./handler.js";
import { startPolling } from "./poller.js";

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
    res.writeHead(status, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
    });
    res.end(JSON.stringify(body));
}

function visitsHandler(req: http.IncomingMessage, res: http.ServerResponse) {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
        let body: unknown;
        try {
            body = JSON.parse(Buffer.concat(chunks).toString());
        } catch {
            sendJson(res, 400, { error: "Invalid JSON body." });
            return;
        }

        const result = registerVisit(body);
        sendJson(res, result.status, result.body);
    });
    req.on("error", () => sendJson(res, 400, { error: "Request body error." }));
}

const server = http.createServer((req, res) => {
    if (req.method === "OPTIONS") {
        res.writeHead(204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST",
            "Access-Control-Allow-Headers": "Content-Type",
        });
        res.end();
        return;
    }

    if (req.method === "POST" && req.url === "/visits") {
        return visitsHandler(req, res);
    }

    sendJson(res, 404, { error: "Not found." });
});

server.listen(3000);
startPolling();

console.log("Demo Service Running...");
