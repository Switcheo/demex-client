import { Client } from './client'
import { AddressUtils, CarbonWallet } from 'carbon-js-sdk'
import { sleep } from './utils'
import 'dotenv/config'
import { MAINNET_TOKENS } from '../types'

function privateKeyStringToUint8Array(privateKeyString) {
  // Use TextEncoder to convert the string to UTF-8 encoded bytes
  const encoder = new TextEncoder()
  const privateKeyBytes = encoder.encode(privateKeyString)

  // Convert the byte array to Uint8Array
  const privateKeyUint8Array = new Uint8Array(privateKeyBytes)

  return privateKeyUint8Array
}

async function run() {
  const b = new Client()
  await b.init({ mnemonic: process.env.MNEMONIC })
  // await b.init({ address: 'swth1ul4yjwg0a7d2exjtk93qtfk9rfpaguzn2xwsgw' })
  // await b.initReadOnly('swth1cseyz9v4krrajpea33u35gxzxm7gu0ltyvqv8e')
  // await b.initReadOnly('swth15ceph9j738ysz3jfec98ddu3y7lpxj6se7cwzj')
  // await b.initReadOnly('swth1ul4yjwg0a7d2exjtk93qtfk9rfpaguzn2xwsgw')
  // b.subscribeOrderBooks(['BTC', 'ETH'])
  b.subscribeAccountData()

  await b.startWebsocket()

  // order book
  // const ethBook = b.getOrderBook('ETH')
  // console.log(ethBook)

  // user balance
  // TODO: non mainnet tokens
  const balance = b.getBalance(MAINNET_TOKENS.USD)
  console.log('availble usd', balance.available.toFormat(2))

  // positions
  const positions = b.getPositions()
  // console.log('positions', positions)

  const position = b.getPosition('BTC')
  // console.log('position', position)

  // open orders
  const orders = b.getOpenOrders('BTC')
  // console.log(orders)

  // account trades
  const trades = await b.getTrades('BTC')
  // console.log(trades)

  const userTrades = await b.getUserTrades('BTC')
  // console.log(userTrades)
}

// start anonymous function
;(async () => {
  await run()
})()
