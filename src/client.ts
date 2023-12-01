import axios from 'axios'
import BigNumber from 'bignumber.js'
import { CarbonSDK, CarbonSDKInitOpts } from 'carbon-js-sdk'
import dayjs from 'dayjs'
import Long from 'long'
import camelCase from 'lodash.camelcase'
import mapKeys from 'lodash.mapkeys'
import WebSocket from 'ws'

import { MarketParams, Book, PriceLevel, BookSideMap, Token } from '../types'
import { sleep, toHumanPrice, toHumanQuantity, sortAsc, sortDesc } from './utils'

export class Client {
  public sdk: CarbonSDK | null
  tokensInfo: { [name: string]: Token }
  marketsInfo: { [name: string]: MarketParams }
  perpMarkets: { [name: string]: MarketParams }
  networkConfig: CarbonSDKInitOpts
  ws: WebSocket
  books: { [name: string]: Book }
  orderbookChannels: string[]
  address: string | null
  initialized: boolean = false

  constructor(options?: CarbonSDKInitOpts) {
    this.tokensInfo = {}
    this.marketsInfo = {}
    this.perpMarkets = {}
    this.books = {}
    this.sdk = null
    this.networkConfig = options
    this.orderbookChannels = []
    this.address = null
  }

  private async init() {
    if (this.initialized) {
      throw new Error('client already initialized')
    }

    const settings = this.networkConfig || { network: CarbonSDK.Network.MainNet }
    this.sdk = await CarbonSDK.instance(settings)

    if (settings.network === CarbonSDK.Network.MainNet) {
      await this.checkLiveliness()
    }
    await this.updateMarketsInfo()
    await this.updateTokensInfo()

    this.initialized = true
  }

  /**
   * Initializes the wallet.
   *
   * @param pkey the private key to use for signing transactions. If not provided, the client will not be able to perform any user actions.
   */
  async initWallet(pkey: string | Buffer) {
    await this.init()
    const settings = this.networkConfig || { network: CarbonSDK.Network.MainNet }
    this.sdk = await this.sdk.clone().connectWithPrivateKey(pkey, {
      ...settings,
      disableRetryOnSequenceError: true,
    })

    this.address = this.sdk.wallet.bech32Address
  }

  private checkInitialization() {
    if (!this.initialized) {
      throw new Error('client not initialized')
    }
  }
  /**
   * Initializes the wallet.
   *
   * @param address? the address that you like to monitor
   */
  async initReadOnly(address: string) {
    await this.init()
    this.address = address
  }

  subscribeOrderBooks(markets: string[]) {
    this.checkInitialization()
    const marketsToSubscribe = []
    for (const book of markets) {
      if (this.perpMarkets[book]) {
        marketsToSubscribe.push(`books:${this.perpMarkets[book].name}`)
      }
    }
    this.orderbookChannels = marketsToSubscribe
  }

  subscribeAccountData() {
    this.checkInitialization()
    if (!this.address) {
      throw new Error('no address provided')
    }
    JSON.stringify({
      id: `balances:${this.address}`,
      method: 'subscribe',
      params: { channels: [`balances:${this.address}`] },
    })
  }

  startWebsocket() {
    this.checkInitialization()
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
              // TODO: implement ws callbacks
            }
          case 'books':
            console.log(update_type, m.channel)
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
      // let marketInfo = mapKeys(market, (v, k) => camelCase(k))
      const marketInfo = {
        ...market,
        basePrecision: market.basePrecision.toNumber(),
        quotePrecision: market.quotePrecision.toNumber(),
        tickSize: new BigNumber(market.tickSize).shiftedBy(-18).toNumber(),
      }
      this.marketsInfo[market.name] = marketInfo
    }
  }
  /* Gets all tokens parameters */
  async updateTokensInfo() {
    const tokensAll = await this.sdk!.query.coin.TokenAll({
      pagination: {
        limit: Long.fromNumber(1000),
        countTotal: false,
        reverse: false,
        offset: Long.UZERO,
        key: new Uint8Array(),
      },
    })
    for (const token of tokensAll.tokens) {
      const tokenInfo = {
        ...token,
        decimals: token.decimals.toNumber(),
        chainId: token.chainId.toNumber(),
        createdBlockHeight: token.createdBlockHeight.toNumber(),
        bridgeId: token.bridgeId.toNumber(),
      }

      if (tokenInfo.isActive) {
        this.tokensInfo[tokenInfo.id] = tokenInfo
      }
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
  // await b.initWallet()
  await b.initReadOnly('swth1cseyz9v4krrajpea33u35gxzxm7gu0ltyvqv8e')
  b.subscribeOrderBooks(['BTC', 'ETH'])
  b.startWebsocket()

  // const m = b.getPerpMarketInfo('BTC')
  // console.log(m)
}

run()
