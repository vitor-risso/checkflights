require('dotenv').config();

const accountSid = process.env.ACCOUNT_SEED;
const authToken = process.env.AUTH_TOKEN;
const client = require('twilio')(accountSid, authToken);

async function enviarMsg(pnr, novoPreco, diferenca) {
    client.messages
    .create({
        from: 'whatsapp:+14155238886',
        to: 'whatsapp:+5519993747589',
        body: `Reemitir reserva ${pnr} o novo preço é de ${novoPreco} totalizando diferença de ${diferenca} milhas por passageiro`
    })
}

module.exports = { enviarMsg }