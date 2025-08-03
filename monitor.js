const fs = require("fs");
const axios = require("axios");
const { enviarMsg } = require('./whatsappsender')

const OCP_KEY = "fb38e642c899485e893eb8d0a373cc17";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
const FILE = "monitoramento.json";

// =============================
// 1️⃣ Funções utilitárias
// =============================
function carregarMonitoramento() {
    if (!fs.existsSync(FILE)) return [];

    const data = fs.readFileSync(FILE, "utf-8").trim();

    if (!data) return []; // arquivo vazio

    try {
        return JSON.parse(data);
    } catch (err) {
        console.error("⚠️ Arquivo monitoramento.json corrompido. Reiniciando...");
        return [];
    }
}


function salvarMonitoramento(dados) {
    try {
        fs.writeFileSync(FILE, JSON.stringify(dados, null, 2));
    } catch (err) {
        console.error("Erro ao salvar monitoramento:", err.message);
    }
}

// =============================
// 2️⃣ Obter Token
// =============================
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
    //console.log("Tkn "+ response.data.data)
    return response.data.data; // JWT
}

// =============================
// 3️⃣ Buscar dados da reserva
// =============================
async function getBookingData(pnr, origem, token, valor_pago) {
    try {
        const url = `https://b2c-api.voeazul.com.br/canonical/api/booking/v5/bookings/${pnr}`;
        const headers = {
            "Authorization": `Bearer ${token}`,
            "Accept": "application/json, text/plain, */*",
            "Referer": "https://www.voeazul.com.br/",
            "Origin": "https://www.voeazul.com.br",
            "Content-Type": "application/json",
            "Ocp-Apim-Subscription-Key": OCP_KEY,
            "User-Agent": USER_AGENT,
            "accept-language": "pt-BR,pt;q=0.9"
        };

        const payload = {
            departureStation: origem
        };

        const response = await axios.post(url, payload, { headers });
        const data = response.data;

        const journey = data.data.journeys[0];

        const primeiroSegmento = journey.segments[0];
        const data_voo = primeiroSegmento.identifier.std.split("T")[0];

        const ultimoSegmento = journey.segments[journey.segments.length - 1];
        const destino = ultimoSegmento.identifier.arrivalStation;

        console.log(data_voo)

        const voos = journey.segments.map(s => s.identifier?.flightNumber || "N/A");

        return {
            pnr,
            origem,
            destino,
            data_voo,
            voos,
            valor_pago_milhas: valor_pago,
            ultima_consulta: null
        };


    } catch (error) {
        console.error("Erro ao buscar reserva:", error.response?.status, error.response?.data || error.message);
        return null;
    }
}


// =============================
// 4️⃣ Buscar voos no site da Azul
// =============================
async function buscarVoos(origem, destino, data, token, voosMonitorados) {
    try {
        const url = "https://b2c-api.voeazul.com.br/tudoAzulReservationAvailability/api/tudoazul/reservation/availability/v6/availability";
        const payload = {
            "criteria": [
                { "departureStation": origem, "arrivalStation": destino, "std": data, "departureDate": data }
            ],
            "passengers": [
                { "type": "ADT", "count": "1", "companionPass": false }
            ],
            "flexibleDays": { "daysToLeft": "0", "daysToRight": "0" },
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
            "sec-ch-ua-platform": '"Linux"',
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-site",
            "user-agent": USER_AGENT,
            "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
        };

        const response = await axios.post(url, payload, { headers });
        //console.log(JSON.stringify(response.data.data))
        const trips = response.data?.data?.trips || [];
        //console.log(trips)

       const dados = response.data.data;

        if (dados?.trips && Array.isArray(dados.trips)) {
            for (const trip of dados.trips) {
                if (!trip.journeys) continue;

                for (const journey of trip.journeys) {

                    // === Acessar todos os flightNumbers dos legs ===
                    const numerosVoo = journey.segments
                        ?.flatMap(seg => seg.legs?.map(leg => leg.identifier.flightNumber) || [])
                        .filter(Boolean);

                    //console.log("✈️ Voos dessa journey:", numerosVoo);

                    // === Acessar todas as opções de pontos ===
                    journey.fares?.forEach(fare => {
                        fare.paxPoints?.forEach(pax => {
                            pax.levels?.forEach(level => {
                                // console.log("💰 Pontos:", level.points.amount);
                                // console.log("💸 Tarifa em dinheiro:", level.fareMoney);
                            });
                        });
                    });

                    // Exemplo: validar se todos os voos são os mesmos que você recebeu
                    //const voosMonitorados = ["4057", "2683"];
                    const contemTodos = voosMonitorados.every(v => numerosVoo.includes(v));

                    if (contemTodos) {
                        const pontos = journey.fares?.[0]?.paxPoints?.[0]?.levels?.[0]?.points?.amount;

                        if (pontos) {
                            return pontos;
                        }
                        console.log("✅ Todos os voos conferem para essa journey.");
                    }
                }
            }
        }

        return null;
    } catch (error) {
        console.error("❌ Erro ao buscar voos:", error);
        return null;
    }
}

// =============================
// 5️⃣ Adicionar reserva ao monitoramento
// =============================
async function adicionarReserva(pnr, origem, valor_pago) {
    const token = await getToken();
    const dados = await getBookingData(pnr, origem, token, valor_pago);

    if (!dados) {
        console.log("❌ Não foi possível buscar os dados da reserva.");
        return;
    }
    dados.data_adicionado = new Date().toISOString();


    const reservas = carregarMonitoramento();
    reservas.push(dados);
    salvarMonitoramento(reservas);

    console.log("✅ Reserva adicionada para monitoramento:", dados);
}

// =============================
// 6️⃣ Rodar verificação de preços
// =============================
async function monitorarPrecos() {
    console.log("\n🔄 Iniciando verificação de preços...");
    const reservas = carregarMonitoramento();
    if (reservas.length === 0) {
        console.log("⚠️ Nenhuma reserva para monitorar.");
        return;
    }

    const token = await getToken();
    const agora = new Date();

    for (let reserva of reservas) {
        try {
            // Verificar se a reserva foi adicionada há menos de 24h
            const adicionada = new Date(reserva.data_adicionado);
            const diffHoras = (agora - adicionada) / (1000 * 60 * 60);

            if (diffHoras > 24) {
                console.log(`⏭️ Ignorando ${reserva.pnr} (adicionada há ${diffHoras.toFixed(1)}h - fora da janela de 24h)`);
                continue;
            }

            // Buscar preço atual
            const precoAtual = await buscarVoos(reserva.origem, reserva.destino, reserva.data_voo, token, reserva.voos);
            await new Promise(resolve => setTimeout(resolve, 10*1000));

            console.log(precoAtual)
            if (precoAtual) {
                console.log(`✈️ ${reserva.pnr} | ${reserva.origem} → ${reserva.destino} | Voos: ${reserva.voos.join(", ")} | Data: ${reserva.data_voo}`);
                console.log(`🔹 Pago: ${reserva.valor_pago_milhas} milhas | 🔻 Atual: ${precoAtual} milhas`);

                if (precoAtual < reserva.valor_pago_milhas) {
                    await enviarMsg(reserva.pnr, precoAtual, (reserva.valor_pago_milhas - precoAtual))
                    console.log("🚨 ALERTA: Preço caiu para os mesmos voos! Pode reemitir.");
                } else {
                    console.log("ℹ️ Nenhuma redução de preço encontrada.");
                }
            } else {
                console.log(`⚠️ Não encontrado o mesmo voo para ${reserva.pnr}`);
            }

            // Atualizar última consulta
            reserva.ultima_consulta = new Date().toISOString();

        } catch (err) {
            console.error(`❌ Erro ao processar reserva ${reserva.pnr}:`, err.message);
        }
    }

    salvarMonitoramento(reservas);
    console.log("✅ Verificação concluída.");
}


// =============================
// 7️⃣ Execução
// =============================

(async () => {
    const args = process.argv.slice(2);

    if (args[0] === "add" && args.length === 4) {
        console.log(`Add: ${args[1]} ${args[2]} e ${args[3]}`)
        await adicionarReserva(args[1], args[2], args[3]);
    } else if (args[0] === "run") {
        await monitorarPrecos();
        // roda a cada 30 min
       setInterval(monitorarPrecos, 30 * 60 * 1000);
    } else {
        console.log("Uso:");
        console.log(" node monitor.js add <PNR> <ORIGEM>");
        console.log(" node monitor.js run");
    }
})();
