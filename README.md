<div align="center">
  <img height="120x" src="https://raw.githubusercontent.com/Switcheo/token-icons/main/demex/demex_color.png" />

  <h1 style="margin-top:20px;">Demex Client</h1>

  <p>
    <a href="https://discord.com/channels/738816874720133172/763588653116555294"><img alt="Discord Chat" src="https://img.shields.io/discord/738816874720133172?color=3e35ff" /></a>
    <a href="https://opensource.org/licenses/Apache-2.0"><img alt="License" src="https://img.shields.io/badge/License-Apache_2.0-3e35ff" /></a>
  </p>
</div>

# Demex Client

This is an opinionated typescript client that wraps around carbon-js-sdk that aims to proivde a simple way to programmatically trade on Carbon's Perpetuals markets.

The client attempts to fetch data over websockets and caches it in memory whenever possible with the exception for trades and funding rates data.

As a result, data fetching functions that are made via GRPC or API have to be made asynchronously while data fetching from the local cache can be made synchronously.

Spot market trading is not supported on this client at the moment.
Only Mainnet is supported on this client at the moment.

## Warning

This client is considered Alpha software and is under develpoment at the moment. Client may contain bugs and hence use at your own risk.

## Features

- [ ] Order submission with human readable inputs with tick and lot sizes rounding
- [ ] Transform outputs to human readable values
- [ ] Accepts human friendly tickers instead of market ids (e.g. "ETH_PERP.USD" -> "cmkt/117")
- [ ] Dead man's switch for chain and indexer liveliness
- [ ] Virtualization of user account state via websockets
- [ ] Virtualization of market data state via websockets
- [ ] Funding rate caculations
- [ ] Wrapped Deposits and withdrawls transfer functions

### Data Fetching Example

```
import { Client } from './client'
import 'dotenv/config'
import { MAINNET_TOKENS } from '../types'


async function run() {
  const bot = new Client()
  await bot.init({ mnemonic: process.env.MNEMONIC })
  bot.subscribeOrderBooks(['BTC', 'ETH'])
  bot.subscribeAccountData()

  await bot.startWebsocket()

  // MARKET DATA

  // order book
  const orderBook = bot.getOrderBook('ETH')

  // recent trades
    const recentTrades = await bot.getTrades('BTC')

  // ACCOUNT DATA

  // user balance
  const usdBalance = bot.getBalance(MAINNET_TOKENS.USD)

  // positions
  const positions = bot.getPositions()

  // position
  const position = bot.getPosition('BTC')

  // open orders
  const orders = bot.getOpenOrders('BTC')

  // account trades
  const userTrades = await bot.getUserTrades('BTC')
}

// start anonymous function
;(async () => {
  await run()
})()

```
