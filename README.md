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

## Constraints

- MAINNET support only
- Perpetuals trading only

## Installation

```
# For NPM
npm install demex-client --legacy-peer-deps

#For Yarn
yarn add demex-client --legacy-peer-deps
```

## Warning

This client is considered Alpha software and is under develpoment at the moment. Client may contain bugs and hence use at your own risk.

## Features

- [ ] Uses human friendly symbols instead of market ids (e.g. "ETH" -> "cmkt/117")
- [ ] Order submission with human readable inputs with tick and lot sizes rounding
- [ ] Transform outputs to human readable values
- [ ] Virtualization of user account state via websockets
- [ ] Virtualization of market data state via websockets
- [ ] Dead man's switch for chain and indexer liveliness
- [ ] Wrap position response with mark price and unrealized profit & loss
- [ ] Warp market stats with funding rates

## WIP

- [ ] Wrapped Deposits and withdrawls transfer functions

### Quickstart

```

import { Client, OrderSide, OrderType } from './client'
import { MAINNET_TOKENS } from '../types'

async function run() {

  const bot = new Client()
  await bot.init({ mnemonic: "YOUR MNEMONIC"})
  bot.subscribeOrderBooks(['BTC', 'ETH'])
  bot.subscribeAccountData()

  await bot.startWebsocket()

  // MARKET DATA

  const orderBook = bot.getOrderBook('ETH')
  const recentTrades = await bot.getTrades('BTC')
  const stats = await bot.getMarketStats()

  // ACCOUNT DATA

  const usdBalance = bot.getBalance(MAINNET_TOKENS.USD)
  const positions = bot.getPositions()
  const position = bot.getPosition('BTC')
  const orders = bot.getOpenOrders('BTC')

  const userTrades = await bot.getUserTrades('BTC')
  const leverages = await bot.getMarketsLeverage()

  // TRANSACTIONS

  const order = await bot.submitOrder({
    market: 'BTC',
    side: OrderSide.Buy,
    price: 40000.001,
    quantity: 0.0011111,
    type: OrderType.Limit,
  })
  const cancels = await bot.cancelAll('BTC')
  cosnt cancel = await.bot.cancelOrder("ORDERID")
  const leverage = await bot.updateLeverage('ETH', 1.3)

}

```
