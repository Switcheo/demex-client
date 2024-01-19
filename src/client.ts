import axios from 'axios'
import BigNumber from 'bignumber.js'
import { CarbonSDK, CarbonSDKInitOpts } from 'carbon-js-sdk'
import dayjs from 'dayjs'
import Long from 'long'
import camelCase from 'lodash.camelcase'
import mapKeys from 'lodash.mapkeys'
import WebSocket from 'ws'

import {
  MarketParams,
  Book,
  PriceLevel,
  BookSideMap,
  Token,
  Balance,
  Order,
  Position,
  WalletInitOpts,
  MAINNET_TOKENS,
  Fill,
  UserFill,
} from '../types'
import {
  sleep,
  toHumanPrice,
  toHumanQuantity,
  sortAsc,
  sortDesc,
  humanizeOrder,
  humanizePosition,
  humanizeFill,
  humanizeUserFill,
} from './utils'

export class Client {
  public sdk: CarbonSDK | null
  tokensInfo: { [market: string]: Token }
  marketsInfo: { [market: string]: MarketParams }
  perpMarkets: { [market: string]: MarketParams }
  networkConfig: CarbonSDKInitOpts
  ws: WebSocket
  orderbookChannels: string[]
  address: string | null
  subscribeAccount: boolean = false
  // mappings
  marketIdtoSymbol: { [symbol: string]: string }
  // checks
  initialized: boolean = false
  wsInitialized: boolean
  wsState: string[]
  // market data
  books: { [market: string]: Book }
  // account data
  last200Fills: Fill[] // sorted by descending block height
  balances: { [denom: string]: Balance }
  openOrders: { [market: string]: Order[] }
  openPositions: { [market: string]: Position }

  constructor(options?: CarbonSDKInitOpts) {
    this.tokensInfo = {}
    this.marketsInfo = {}
    this.perpMarkets = {}
    this.sdk = null
    this.networkConfig = options
    this.orderbookChannels = []
    this.subscribeAccount = false
    this.address = null
    this.wsInitialized = false
    this.wsState = []
    this.marketIdtoSymbol = {}

    // virtualization
    this.books = {}
    this.balances = {}
    this.openOrders = {}
    this.openPositions = {}
    this.last200Fills = []
  }

  /**
   * Initializes the signer wallet.
   */
  async init(opts: WalletInitOpts) {
    if (this.initialized) {
      throw new Error('client already initialized')
    }

    const settings = this.networkConfig || { network: CarbonSDK.Network.MainNet }
    this.sdk = await CarbonSDK.instance(settings)

    if (settings.network === CarbonSDK.Network.MainNet) {
      await this.checkLiveliness()
    }

    if (opts.pkey) {
      this.sdk = await this.sdk.clone().connectWithPrivateKey(opts.pkey, {
        ...settings,
        disableRetryOnSequenceError: true,
      })
      this.address = this.sdk.wallet.bech32Address
    }
    if (opts.mnemonic) {
      this.sdk = await this.sdk.clone().connectWithMnemonic(opts.mnemonic, {
        ...settings,
        disableRetryOnSequenceError: true,
      })
      this.address = this.sdk.wallet.bech32Address
    }
    if (opts.address) {
      this.address = opts.address
    }

    await this.updateMarketsInfo()
    await this.updateTokensInfo()

    this.initialized = true
  }

  private checkInitialization() {
    if (!this.initialized) {
      throw new Error('client not initialized')
    }
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
    this.subscribeAccount = true
  }

  private updateWsState(channel: string) {
    const state = this.wsState
    const index = state.indexOf(channel)

    if (index !== -1) {
      // Use splice to remove the element at the found index
      state.splice(index, 1)
    }
    this.wsState = state
  }

  async startWebsocket() {
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
        this.wsState = this.wsState.concat(this.orderbookChannels)
      }
      if (this.subscribeAccount) {
        this.ws.send(
          JSON.stringify({
            id: `positions`,
            method: 'subscribe',
            params: {
              channels: [`positions:${this.address}`],
            },
          })
        )
        this.ws.send(
          JSON.stringify({
            id: `orders`,
            method: 'subscribe',
            params: {
              channels: [`orders:${this.address}`],
            },
          })
        )
        this.ws.send(
          JSON.stringify({
            id: `balances`,
            method: 'subscribe',
            params: { channels: [`balances:${this.address}`] },
          })
        )
        this.ws.send(
          JSON.stringify({
            id: `account_trades`,
            method: 'subscribe',
            params: { channels: [`account_trades:${this.address}`] },
          })
        )
        this.wsState = this.wsState.concat([
          `account_trades:${this.address}`,
          `balances:${this.address}`,
          `positions:${this.address}`,
          `orders:${this.address}`,
        ])
      }
      this.wsInitialized = true
    })

    this.ws.on('message', message => {
      const m = JSON.parse(message as any)
      if (m.channel) {
        const types = m.channel.split(':')
        const { result, update_type } = m
        switch (types[0]) {
          case 'books':
            const market = types[1]

            if (update_type === 'full_state') {
              const bids: PriceLevel[] = []
              const asks: PriceLevel[] = []

              for (const level of result.bids) {
                bids.push({
                  price: toHumanPrice(level.price, this.marketsInfo[market]),
                  quantity: toHumanQuantity(
                    level.quantity,
                    this.marketsInfo[market].basePrecision
                  ),
                })
              }
              for (const level of result.asks) {
                asks.push({
                  price: toHumanPrice(level.price, this.marketsInfo[market]),
                  quantity: toHumanQuantity(
                    level.quantity,
                    this.marketsInfo[market].basePrecision
                  ),
                })
              }

              this.books[market] = {
                bids,
                asks,
              }
              this.updateWsState(m.channel)
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
                const quantity = toHumanQuantity(
                  item.quantity,
                  this.marketsInfo[market].basePrecision
                )
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
              this.books[market] = {
                bids,
                asks,
              }
              // TODO: implement ws callbacks
            } else {
              console.log('unknown update_type', update_type)
            }
            break
          case 'balances':
            if (update_type === 'full_state') {
              for (const r of result) {
                const { denom, available, order, position } = r
                const { decimals } = this.tokensInfo[denom]
                this.balances[denom] = {
                  available: new BigNumber(available).shiftedBy(-decimals),
                  order: new BigNumber(order).shiftedBy(-decimals),
                  position: new BigNumber(position).shiftedBy(-decimals),
                  total: new BigNumber(available)
                    .plus(order)
                    .plus(position)
                    .shiftedBy(-decimals),
                }
              }
              this.updateWsState(m.channel)
            } else {
              for (const r of result) {
                const { denom, available, order, position } = r
                const { decimals } = this.tokensInfo[denom]
                this.balances[denom] = {
                  available: new BigNumber(available).shiftedBy(-decimals),
                  order: new BigNumber(order).shiftedBy(-decimals),
                  position: new BigNumber(position).shiftedBy(-decimals),
                  total: new BigNumber(available)
                    .plus(order)
                    .plus(position)
                    .shiftedBy(-decimals),
                }
              }
            }
            break
          case 'orders':
            if (update_type === 'full_state') {
              const openOrders = {}
              for (const o of result.open_orders) {
                const { market } = o
                const info = this.marketsInfo[market]
                const order = humanizeOrder(o, info)

                if (!openOrders[market]) {
                  openOrders[market] = []
                }
                openOrders[market].push(order)
              }
              this.openOrders = openOrders
              this.updateWsState(m.channel)
            } else {
              for (const o of result) {
                const { market } = o
                if (o.type === 'update') {
                  const { status } = o
                  const index = this.openOrders[market].findIndex(
                    order => order.id === o.id
                  )
                  if (status === 'cancelled') {
                    this.openOrders[market].splice(index, 1)
                  } else {
                    const info = this.marketsInfo[market]
                    const order = humanizeOrder(o, info)
                    this.openOrders[market][index] = order
                  }
                } else if (o.type === 'new') {
                  const info = this.marketsInfo[market]
                  const order = humanizeOrder(o, info)
                  if (!this.openOrders[market]) {
                    this.openOrders[market] = []
                  }
                  this.openOrders[market].push(order)
                } else {
                  console.log('this should not happen', o.type)
                }
              }
            }
            break
          case 'positions':
            if (update_type === 'full_state') {
              for (const p of result.open_positions) {
                const position = humanizePosition(p, this.marketsInfo[p.market])
                this.openPositions[p.market] = position
              }
              this.updateWsState(m.channel)
            } else {
              for (const p of result) {
                const position = humanizePosition(p, this.marketsInfo[p.market])
                this.openPositions[p.market] = position
              }
            }
            break
          case 'account_trades':
            if (update_type === 'full_state') {
              const fills = []
              for (const f of result) {
                const fill = humanizeFill(f, this.marketsInfo[f.market])
                fills.push(fill)
              }
              console.log(fills.length)
              this.last200Fills = fills
              this.updateWsState(m.channel)
            } else {
              const fills = this.last200Fills
              for (const f of result) {
                const fill = humanizeFill(f, this.marketsInfo[f.market])
                fills.unshift(fill)
              }
              if (fills.length > 200) {
                const slicedFills = fills.slice(0, 200)
                this.last200Fills = slicedFills
              } else {
                this.last200Fills = fills
              }
            }
            break
        }
      }
    })
    while (!this.wsInitialized) {
      await sleep(100)
    }
    while (this.wsState.length > 0) {
      await sleep(1000)
    }
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

    if (heightDifference.gt(15)) {
      throw new Error(
        `api is lagging behind the chain height by more than ${heightDifference} blocks`
      )
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
        limit: Long.fromNumber(1500),
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
        this.tokensInfo[tokenInfo.denom] = tokenInfo
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
        this.marketIdtoSymbol[marketInfo.name] = key
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
    if (this.perpMarkets[ticker]) {
      return this.perpMarkets[ticker.toUpperCase()]
    }
    throw new Error('market not found')
  }

  //
  // GETTERS
  //

  getOrderBook(market: string): Book {
    const id = this.getPerpMarketInfo(market).name
    if (!this.books[id]) {
      throw new Error(`${market} not found in order books. Did you subscribe?`)
    }
    return this.books[id]
  }

  getBalance(denom: MAINNET_TOKENS): Balance {
    if (this.balances[denom]) {
      return this.balances[denom]
    }
    return {
      available: new BigNumber(0),
      order: new BigNumber(0),
      position: new BigNumber(0),
      total: new BigNumber(0),
    }
  }

  getPositions(): Position[] {
    const positions = []
    for (const market of Object.keys(this.openPositions)) {
      const position = this.openPositions[market]
      position.symbol = this.marketIdtoSymbol[market]
      positions.push(position)
    }
    return positions
  }

  getPosition(market: string): Position {
    const empty = {
      symbol: market,
      allocated_margin: 0,
      avg_entry_price: 0,
      lots: 0,
      side: '',
    }

    if (!this.perpMarkets[market]) return empty

    const id = this.perpMarkets[market].name

    if (this.openPositions[id]) {
      const position = this.openPositions[id]
      position.symbol = market
      return position
    }

    return empty
  }

  getOpenOrders(market?: string): Order[] {
    const orders = []
    const markets = Object.keys(this.openOrders)
    for (const m of markets) {
      this.openOrders[m].forEach(order => {
        orders.push({ ...order, symbol: this.marketIdtoSymbol[m] })
      })
    }

    if (market) {
      return orders.filter(order => order.symbol === market)
    }
    return orders
  }

  async getUserTrades(market?: string): Promise<UserFill[]> {
    // uses the API endpoint instead of GRPC as the API endpoint is more flexible
    let url = `https://api.carbon.network/carbon/broker/v1/trades?pagination.limit=200&pagination.count_total=false&address=${this.address}`
    if (market) {
      const marketId = this.getPerpMarketInfo(market).name
      url = `${url}&market=${marketId}`
    }

    const { trades } = (await axios.get(url)).data
    const fills = trades.map(fill => {
      const symbol = this.marketIdtoSymbol[fill.market]
      const hFill = humanizeUserFill(fill, this.marketsInfo[fill.market], this.address)
      return { ...hFill, symbol }
    })
    return fills
  }

  async getTrades(market?: string): Promise<Fill[]> {
    // uses the API endpoint instead of GRPC as the API endpoint is more flexible
    let url = `https://api.carbon.network/carbon/broker/v1/trades?pagination.limit=200&pagination.count_total=false`
    if (market) {
      const marketId = this.getPerpMarketInfo(market).name
      url = `${url}&market=${marketId}`
    }

    const { trades } = (await axios.get(url)).data
    const fills = trades.map(fill => {
      const symbol = this.marketIdtoSymbol[fill.market]
      const hFill = humanizeFill(fill, this.marketsInfo[fill.market])
      return { ...hFill, symbol }
    })
    return fills
  }
}
