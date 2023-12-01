import axios from 'axios'
import BigNumber from 'bignumber.js'
import { CarbonSDK, CarbonSDKInitOpts } from 'carbon-js-sdk'
import dayjs from 'dayjs'
import Long from 'long'
import camelCase from 'lodash.camelcase'
import mapKeys from 'lodash.mapkeys'
import WebSocket from 'ws'

import { MarketParams, Book, PriceLevel, BookSideMap } from '../types'
import { sleep, toHumanPrice, toHumanQuantity, sortAsc, sortDesc } from './utils'

export class Client {
  public sdk: CarbonSDK | null
  marketsInfo: { [name: string]: MarketParams }
  perpMarkets: { [name: string]: MarketParams }
  networkConfig: CarbonSDKInitOpts
  ws: WebSocket
  books: { [name: string]: Book }
  orderbookChannels: string[]

  constructor(options?: CarbonSDKInitOpts) {
    this.marketsInfo = {}
    this.perpMarkets = {}
    this.books = {}
    this.sdk = null
    this.networkConfig = options
    this.orderbookChannels = []
  }

  /**
   * Calculates the square root of a number.
   *
   * @param network the network to connect the client to
   * @param pkey? the private key to use for signing transactions. If not provided, the client will not be able to perform any user actions.
   */
  async init(pkey?: string | Buffer) {
    const settings = this.networkConfig || { network: CarbonSDK.Network.MainNet }
    this.sdk = await CarbonSDK.instance(settings)

    if (settings.network === CarbonSDK.Network.MainNet) {
      await this.checkLiveliness()
    }

    await this.updateMarketsInfo()

    if (pkey) {
      this.sdk = await this.sdk.clone().connectWithPrivateKey(pkey, {
        ...settings,
        disableRetryOnSequenceError: true,
      })
    }
  }

  subscribeOrderBooks(markets: string[]) {
    const marketsToSubscribe = []
    for (const book of markets) {
      if (this.perpMarkets[book]) {
        marketsToSubscribe.push(`books:${this.perpMarkets[book].name}`)
      }
    }
    this.orderbookChannels = marketsToSubscribe
  }

  startWebsocket() {
    this.ws = new WebSocket('wss://ws-api.carbon.network/ws')
    this.ws.on('open', async () => {
      while (this.ws.readyState !== 1) {
        await sleep(1000)
      }
      console.log('websocket connected')

      if (this.orderbookChannels.length > 0) {
        this.ws.send(
          JSON.stringify({
            id: `orderbooks`,
            method: 'subscribe',
            params: {
              channels: this.orderbookChannels,
            },
          })
        )
      }
    })

    this.ws.on('message', message => {
      const m = JSON.parse(message as any)
      // console.log(m)

      if (m.channel) {
        const types = m.channel.split(':')
        switch (types[0]) {
          case 'books':
            const { result, update_type } = m
            const market = types[1]
            console.log(update_type, m.channel)

            if (update_type === 'full_state') {
              const bids: PriceLevel[] = []
              const asks: PriceLevel[] = []

              for (const level of result.bids) {
                bids.push({
                  price: toHumanPrice(level.price, this.marketsInfo[market]),
                  quantity: toHumanQuantity(level.quantity, this.marketsInfo[market]),
                })
              }
              for (const level of result.asks) {
                asks.push({
                  price: toHumanPrice(level.price, this.marketsInfo[market]),
                  quantity: toHumanQuantity(level.quantity, this.marketsInfo[market]),
                })
              }

              this.books[market] = {
                bids,
                asks,
              }
            } else if (update_type === 'delta') {
              const newBidsState: BookSideMap = {}
              const newAsksState: BookSideMap = {}
              for (const item of this.books[market].bids) {
                newBidsState[item.price] = item.quantity
              }
              for (const item of this.books[market].asks) {
                newAsksState[item.price] = item.quantity
              }
              for (const item of m.result) {
                const price = toHumanPrice(item.price, this.marketsInfo[market])
                const quantity = toHumanQuantity(item.quantity, this.marketsInfo[market])
                switch (item.type) {
                  case 'new':
                    if (item.side === 'buy') {
                      newBidsState[price] = quantity
                      break
                    }
                    if (item.side === 'sell') {
                      newAsksState[price] = quantity
                      break
                    }
                  case 'update':
                    if (item.side === 'buy') {
                      if (!newBidsState[price]) {
                        break
                      }
                      newBidsState[price] = new BigNumber(newBidsState[price])
                        .plus(quantity)
                        .toNumber()
                      break
                    }
                    if (item.side === 'sell') {
                      if (!newAsksState[price]) {
                        break
                      }
                      newAsksState[price] = new BigNumber(newAsksState[price])
                        .plus(quantity)
                        .toNumber()
                      break
                    }
                  case 'delete':
                    if (item.side === 'buy') {
                      delete newBidsState[price]
                      break
                    }
                    if (item.side === 'sell') {
                      delete newAsksState[price]
                      break
                    }
                }
              }

              const bids = Object.keys(newBidsState)
                .sort(sortDesc)
                .map(priceLevel => {
                  return {
                    price: parseFloat(priceLevel),
                    quantity: newBidsState[priceLevel],
                  }
                })
              const asks = Object.keys(newAsksState)
                .sort(sortAsc)
                .map(priceLevel => {
                  return {
                    price: parseFloat(priceLevel),
                    quantity: newAsksState[priceLevel],
                  }
                })
              console.log(bids, asks)
              // .map((level: OrderBookWsEvent) => ({
              //   price: level.price,
              //   quantity: level.quantity,
              // }))

              // this.books[market] = {
              //   bids: newBidsState,
              //   asks: newAsksState,
              // }
            }
        }
      }
    })
  }

  /**
   * Checks whether the chain is alive and the api is in sync with the chain.
   */
  async checkLiveliness() {
    const url = 'https://tm-api.carbon.network/status'
    const { result } = (await axios.get(url)).data

    const { latest_block_height, latest_block_time } = result.sync_info

    const now = dayjs().unix()
    const diff = now - dayjs(latest_block_time).unix()

    if (diff > 60) {
      throw new Error('chain is dead')
    }

    const persistence = (
      await axios.get(
        'https://api.carbon.network/carbon/misc/v1/blocks?pagination.limit=1'
      )
    ).data.blocks[0]

    const { block_height } = persistence
    const heightDifference = new BigNumber(latest_block_height).minus(block_height)

    if (heightDifference.gt(10)) {
      throw new Error('api is lagging behind the chain height by more than 10 blocks')
    }
  }
  /* Gets all markets parameters */
  async updateMarketsInfo() {
    const marketsAll = await this.sdk!.query.market.MarketAll({
      pagination: {
        limit: Long.fromNumber(500),
        countTotal: false,
        reverse: false,
        offset: Long.UZERO,
        key: new Uint8Array(),
      },
    })
    this.mapPerpMarkets(marketsAll.markets)
    for (const market of marketsAll.markets) {
      let marketInfo = mapKeys(market, (v, k) => camelCase(k))
      marketInfo = {
        ...market,
        basePrecision: market.basePrecision.toNumber(),
        quotePrecision: market.quotePrecision.toNumber(),
        tickSize: new BigNumber(market.tickSize).shiftedBy(-18).toNumber(),
      }
      this.marketsInfo[market.name] = marketInfo
    }
  }

  /**
   * Helper function to retrive all perp markets and assign the underlying market symbol as a key
   */

  mapPerpMarkets(markets) {
    const perps = {}
    for (const market of markets) {
      const marketInfo = mapKeys(market, (v, k) => camelCase(k))
      if (
        marketInfo.marketType === 'futures' &&
        marketInfo.description.includes('Perpetual') &&
        marketInfo.isActive
      ) {
        const key = marketInfo.displayName.split('_')[0]
        perps[key] = {
          ...market,
          basePrecision: market.basePrecision.toNumber(),
          quotePrecision: market.quotePrecision.toNumber(),
          tickSize: new BigNumber(market.tickSize).shiftedBy(-18).toNumber(),
        }
      }
    }
    this.perpMarkets = perps
  }

  /**
   * Gets the market info for a given ticker
   * @param symbol ticker
   */
  getPerpMarketInfo(ticker: string) {
    return this.perpMarkets[ticker.toUpperCase()]
  }
}

async function run() {
  const b = new Client()
  await b.init()
  b.subscribeOrderBooks(['BTC', 'ETH'])
  b.startWebsocket()

  // const m = b.getPerpMarketInfo('BTC')
  // console.log(m)
}

run()
