const fs = require("fs");
const puppeteer = require("puppeteer");

const OCP_KEY = "fb38e642c899485e893eb8d0a373cc17";

async function buscarVoos(origem, destino, data) {
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage"
        ]
    });

    const page = await browser.newPage();

    // Define o user-agent para simular navegador real
    await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36");
    
    // Vai para o site da Azul para obter cookies reais
    await page.goto("https://www.voeazul.com.br", {
        waitUntil: "networkidle2",
    });

    // Obter token via fetch (usando o browser)
    const token = await page.evaluate(async (OCP_KEY) => {
        const res = await fetch("https://b2c-api.voeazul.com.br/authentication/api/authentication/v1/token", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json, text/plain, */*",
                "Origin": "https://www.voeazul.com.br",
                "Referer": "https://www.voeazul.com.br",
                "Ocp-Apim-Subscription-Key": OCP_KEY
            },
            body: JSON.stringify({ grantType: "anonymous", channel: "web" })
        });
        const data = await res.json();
        return data.data;
    }, OCP_KEY);

    console.log("✅ Token obtido:", token);

    // Agora faz a chamada de disponibilidade dentro do browser para evitar fingerprint bloqueado
    const resultado = await page.evaluate(async ({ origem, destino, data, token, OCP_KEY }) => {
        const payload = {
            "criteria": [
                { "departureStation": origem, "arrivalStation": destino, "std": data, "departureDate": data }
            ],
            "passengers": [
                { "type": "ADT", "count": "1", "companionPass": false }
            ],
            "flexibleDays": { "daysToLeft": "1", "daysToRight": "1" },
            "currencyCode": "BRL",
            "searchRoute": `/br/pt/home/selecao-voo?c[0].ds=${origem}&c[0].std=${data}&c[0].as=${destino}&p[0].t=ADT&p[0].c=1&p[0].cp=false&f.dl=3&f.dr=3&cc=PTS`
        };

        const res = await fetch("https://b2c-api.voeazul.com.br/tudoAzulReservationAvailability/api/tudoazul/reservation/availability/v6/availability", {
            method: "POST",
            headers: {
                "authorization": `Bearer ${token}`,
                "accept": "application/json, text/plain, */*",
                "content-type": "application/json",
                "culture": "pt-BR",
                "device": "novosite",
                "ocp-apim-subscription-key": OCP_KEY,
                "origin": "https://www.voeazul.com.br",
                "referer": "https://www.voeazul.com.br/"
            },
            body: JSON.stringify(payload)
        });
        return await res.json();
    }, { origem, destino, data, token, OCP_KEY });

    // Salva resultado bruto
    fs.writeFileSync("raw_resultado_voos.json", JSON.stringify(resultado, null, 2), "utf-8");

    // Se houver dados válidos, processa os preços
    const saida = [];

    if (resultado?.data?.trips) {
        resultado.data.trips.forEach(trip => {
            trip.journeys.forEach(journey => {
                journey.fares.forEach(fare => {
                    const todosLevels = fare.paxPoints.flatMap(p => p.levels || []);
                    if (todosLevels.length === 0) return;

                    const levelsOrdenados = [...todosLevels].sort((a, b) => a.points.amount - b.points.amount);

                    const selecionados = [];
                    selecionados.push(levelsOrdenados[0]);
                    if (levelsOrdenados.length > 1 && levelsOrdenados[levelsOrdenados.length - 1].points.amount !== levelsOrdenados[0].points.amount) {
                        selecionados.push(levelsOrdenados[levelsOrdenados.length - 1]);
                    }

                    const valores = selecionados.map(level => {
                        let convenienceFee = level.convenienceFee || 0;
                        if (convenienceFee === 39.9 || convenienceFee === 39.90) {
                            convenienceFee = 59.90;
                        }
                        const totalFinal = (level.totalMoney || 0) + convenienceFee;

                        return {
                            pontos: level.points.amount,
                            taxas: totalFinal
                        };
                    });

                    const voos = journey.segments.map(seg => ({
                        numeroVoo: seg.identifier.flightNumber,
                        companhia: seg.identifier.carrierCode,
                        aeronave: seg.equipment?.name || "Não informado",
                        origem: seg.identifier.departureStation,
                        destino: seg.identifier.arrivalStation,
                        partida: seg.identifier.std,
                        chegada: seg.identifier.sta
                    }));

                    saida.push({
                        origem: trip.departureStation,
                        destino: trip.arrivalStation,
                        valores,
                        voos
                    });
                });
            });
        });
    }

    fs.writeFileSync("resultado_voos.json", JSON.stringify(saida, null, 2), "utf-8");
    console.log("✅ Dados salvos em resultado_voos.json");

    await browser.close();
}

buscarVoos("VCP", "SSA", "2025-08-10");
