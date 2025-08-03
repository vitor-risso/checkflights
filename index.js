const fs = require("fs");
const axios = require("axios");

const OCP_KEY = "fb38e642c899485e893eb8d0a373cc17";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

async function getToken() {
    const url = "https://b2c-api.voeazul.com.br/authentication/api/authentication/v1/token";
    const payload = { grantType: "anonymous", channel: "web" };

    const headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://www.voeazul.com.br/",
        "Origin": "https://www.voeazul.com.br",
        "Ocp-Apim-Subscription-Key": OCP_KEY,
        "User-Agent": USER_AGENT
    };

    const response = await axios.post(url, payload, { headers });
    //console.log(response.data)
    return response.data.data; // ✅ pegar só o token JWT
}

async function buscarVoos(origem, destino, data) {
    const token = await getToken();

    const url = "https://b2c-api.voeazul.com.br/tudoAzulReservationAvailability/api/tudoazul/reservation/availability/v6/availability";

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

    const headers = {
        "authorization": `Bearer ${token}`,
        "accept": "application/json, text/plain, */*",
        "content-type": "application/json",
        "culture": "pt-BR",
        "customerkey": "66eac0d25234157e769e6b69700f462862d5451ba116e71056a606e7",
        "customernumber": "9873382550",
        "device": "novosite",
        "ocp-apim-subscription-key": OCP_KEY,
        "origin": "https://www.voeazul.com.br",
        "referer": "https://www.voeazul.com.br/",
        "sec-ch-ua": '"Not)A;Brand";v="8", "Chromium";v="138", "Google Chrome";v="138"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"macOS"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-site",
        "user-agent": USER_AGENT,
        "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
    };

    try {
        const response = await axios.post(url, payload, { headers });
        const resultado = [];

        response.data.data.trips.forEach(trip => {
            trip.journeys.forEach(journey => {
                journey.fares.forEach(fare => {
                    fare.paxPoints.forEach(pax => {
                        // Junta todos os níveis em um único array
                        const todosLevels = fare.paxPoints.flatMap(pax => pax.levels || []);

                        // Se não houver níveis, pula
                        if (todosLevels.length === 0) return;

                        // Ordena do mais barato para o mais caro
                        const levelsOrdenados = [...todosLevels].sort((a, b) => a.points.amount - b.points.amount);

                        // Pega o mais barato e o mais caro, garantindo que sejam diferentes
                        const selecionados = [];
                        selecionados.push(levelsOrdenados[0]); // mais barato
                        if (levelsOrdenados.length > 1 && levelsOrdenados[levelsOrdenados.length - 1].points.amount !== levelsOrdenados[0].points.amount) {
                            selecionados.push(levelsOrdenados[levelsOrdenados.length - 1]); // mais caro
                        }
                        console.log(selecionados)

                        // Monta os valores finais
                        const valores = selecionados.map(level => {
                            let convenienceFee = level.convenienceFee || 0;
                            if (convenienceFee === 39.9 || convenienceFee === 39.90) {
                                convenienceFee = 59.90;
                            }

                            // Soma totalMoney (já inclui taxesAndFees + fareMoney)
                            const totalFinal = (level.totalMoney || 0) + convenienceFee;

                            return {
                                pontos: level.points.amount,
                                taxas: totalFinal
                            };
                        })

                        // Lista todos os voos do trecho
                        const voos = journey.segments.map(seg => ({
                            numeroVoo: seg.identifier.flightNumber,
                            companhia: seg.identifier.carrierCode,
                            aeronave: seg.equipment?.name || "Não informado",
                            origem: seg.identifier.departureStation,
                            destino: seg.identifier.arrivalStation,
                            partida: seg.identifier.std,
                            chegada: seg.identifier.sta
                        }));

                        resultado.push({
                            origem: trip.departureStation,
                            destino: trip.arrivalStation,
                            valores,
                            voos
                        });
                    });
                });
            });
        });
        fs.writeFileSync("raw_resultado_voos.json", JSON.stringify(response.data, null, 2), "utf-8");

        fs.writeFileSync("resultado_voos.json", JSON.stringify(resultado, null, 2), "utf-8");
        
        //console.log("✅ JSON Formatado:", JSON.stringify(response.data, null, 2));
    } catch (error) {
        console.error("❌ Erro na busca:", error.response?.status, error.response?.data || error.message);
    }
}


buscarVoos("VCP", "SSA", "2025-08-10")