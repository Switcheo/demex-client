import axios from 'axios'
import BigNumber from 'bignumber.js'
import { AddressUtils, CarbonSDK, CarbonSDKInitOpts, CarbonTx } from 'carbon-js-sdk'
import { MsgCreateOrder } from 'carbon-js-sdk/lib/codec/Switcheo/carbon/order/tx'

import dayjs from 'dayjs'
import Long from 'long'
import camelCase from 'lodash.camelcase'
import mapKeys from 'lodash.mapkeys'
import WebSocket from 'ws'
import { Events } from './events'

BigNumber.set({ EXPONENTIAL_AT: 100 })

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
  UsageMultiplier,
  MarketStats,
  OrderParams,
  OrderSide,
  Txn,
  UserLeverage,
  Trade,
  DepositSupportedNetworks,
  ClientOpts,
  PerpMarketParams,
  BookState,
  BookSideState,
  OrderType,
} from './types'
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
  AuthorizedSignlessMsgs,
} from './utils'
import { ethers } from 'ethers'
import { SWTHAddress } from 'carbon-js-sdk/lib/util/address'
import { CarbonAPI } from './apis'
import {
  AllowedMsgAllowance,
  BasicAllowance,
} from 'carbon-js-sdk/lib/codec/cosmos/feegrant/v1beta1/feegrant'

export class Client {
  public sdk: CarbonSDK | null
  tokensInfo: { [market: string]: Token }
  marketsInfo: { [market: string]: MarketParams }
  perpMarkets: { [market: string]: MarketParams }
  clientOptions: ClientOpts
  ws: WebSocket
  orderbookChannels: string[]
  address: string | null
  subscribeAccount: boolean = false
  subscribeStats: boolean = false
  // mappings
  marketIdtoSymbol: { [symbol: string]: string }
  oraclesIdtoSymbol: { [symbol: string]: string }
  // checks
  initialized: boolean = false
  wsInitialized: boolean
  wsState: string[]
  // market data
  books: { [market: string]: BookState }
  stats: {
    [market: string]: {
      premiumRate: number
      markPrice: number
      indexPrice: number
      volume: number
      lastPrice: number
      fundingRate?: number

      market_id: string
      market_type: string
      day_open: string
      day_high: string
      day_low: string
      day_close: string
      day_volume: string
      day_quote_volume: string
      index_price: string
      mark_price: string
      last_price: string
      premium_rate: string
      last_funding_at: string
      open_interest: string
    }
  }
  // account data
  last200Fills: Trade[] // sorted by descending block height
  balances: { [denom: string]: Balance }
  openOrders: { [market: string]: Order[] }
  openPositions: { [market: string]: Position }
  events: Events
  evmSigners: {
    eth: ethers.Signer | null
    arb: ethers.Signer | null
  }
  api: CarbonAPI
  baseUrl: string

  constructor(options?: ClientOpts) {
    this.tokensInfo = {}
    this.marketsInfo = {}
    this.perpMarkets = {}
    this.sdk = null
    this.clientOptions = options
    this.orderbookChannels = []
    this.subscribeAccount = false
    this.subscribeStats = false
    this.address = null
    this.wsInitialized = false
    this.wsState = []
    this.marketIdtoSymbol = {}
    this.oraclesIdtoSymbol = {}

    // virtualization
    this.books = {}
    this.balances = {}
    this.openOrders = {}
    this.openPositions = {}
    this.last200Fills = []

    // market data
    this.stats = {}

    // emitter
    this.events = new Events()

    // signers
    this.evmSigners = {
      eth: null,
      arb: null,
    }
    this.baseUrl = 'api'
    if (options && options.network) {
      if (options.network === CarbonSDK.Network.TestNet) {
        this.baseUrl = 'test-api'
      } 
    } 
    this.api = new CarbonAPI(this.baseUrl)
  }

  /**
   * Initializes the signer wallet.
   */
  async init(opts: WalletInitOpts) {
    if (this.initialized) {
      throw new Error('client already initialized')
    }

    const settings = this.clientOptions || { network: CarbonSDK.Network.MainNet }
    this.sdk = await CarbonSDK.instance(settings)

    if (settings.network === CarbonSDK.Network.MainNet) {
      await this.checkLiveliness(opts.skipAPICheck)
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

    if (opts.ethSigner) {
      this.evmSigners.eth = opts.ethSigner
    }

    if (opts.arbSigner) {
      this.evmSigners.arb = opts.arbSigner
    }

    console.log(`wallet address: ${this.address}`)

    await this.updateTokensInfo()
    await this.updateMarketsInfo()
    // await this.getMarketStats()
    // this.fetchOraclePrices()

    if (this.clientOptions && this.clientOptions.enablePolling) {
    }
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
        marketsToSubscribe.push(`books:${this.perpMarkets[book].id}`)
      }
    }
    this.orderbookChannels = marketsToSubscribe
  }
  subscribeMarketStats() {
    this.checkInitialization()
    this.subscribeStats = true
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

  private processOrderSide(current, incoming) {
    for (const item of incoming) {
      const { price, quantity } = item
      if (!current[price]) {
        current[price] = quantity
      } else {
        current[price] = new BigNumber(current[price]).plus(quantity).toString()
      }
      if (new BigNumber(current[price]).isZero()) {
        delete current[price]
      }
    }
    return current
  }

  private humanizeOrderbook(book: BookState, info): Book {
    const { bids, asks } = book
    const humanBids = Object.keys(bids)
      .sort(sortDesc)
      .map(price => {
        const p = toHumanPrice(price, info)
        const quantity = toHumanQuantity(bids[price], info.basePrecision)
        return {
          price: p,
          quantity,
        }
      })
    const humanAsks = Object.keys(asks)
      .sort(sortAsc)
      .map(price => {
        const p = toHumanPrice(price, info)
        const quantity = toHumanQuantity(asks[price], info.basePrecision)
        return {
          price: p,
          quantity,
        }
      })

    return {
      bids: humanBids,
      asks: humanAsks,
    }
  }

  async startWebsocket() {
    const unix = dayjs().unix()
    this.checkInitialization()
    this.ws = new WebSocket(this.sdk.getConfig().wsUrl)
    // this.ws = new WebSocket('wss://ws-api.carbon.network/ws')
    this.ws.on('open', async () => {
      while (this.ws.readyState !== 1) {
        await sleep(1000)
      }
      console.log('websocket connected')

      // this.ws.on('ping', () => {
      //   console.log('PONG')
      // })

      this.ws.on('close', () => {
        console.log('websocket closed')
      })

      if (this.orderbookChannels.length > 0) {
        this.ws.send(
          JSON.stringify({
            id: `orderbooks-${unix.toString()}`,
            method: 'subscribe',
            params: {
              channels: this.orderbookChannels,
            },
          })
        )
        this.wsState = this.wsState.concat(this.orderbookChannels)
      }
      if (this.subscribeStats) {

        console.log('subscribing to market stats')
        this.ws.send(
          JSON.stringify({
            id: `stats-${unix.toString()}`,
            method: 'subscribe',
            params: {
              channels: [`market_stats`],
            },
          })
        )
      }
      if (this.subscribeAccount) {
        console.log('subscribing to account data')
        this.ws.send(
          JSON.stringify({
            id: `positions-${this.address.slice(-4)}`,
            method: 'subscribe',
            params: {
              channels: [`positions:${this.address}`],
            },
          })
        )
        this.ws.send(
          JSON.stringify({
            id: `orders-${this.address.slice(-4)}`,
            method: 'subscribe',
            params: {
              channels: [`orders:${this.address}`],
            },
          })
        )
        this.ws.send(
          JSON.stringify({
            id: `balances-${this.address.slice(-4)}`,
            method: 'subscribe',
            params: { channels: [`balances:${this.address}`] },
          })
        )
        this.ws.send(
          JSON.stringify({
            id: `account_trades-${this.address.slice(-4)}`,
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
              const bids: BookSideState = {}
              const asks: BookSideState = {}

              for (const level of result.bids) {
                bids[level.price] = level.quantity
              }
              for (const level of result.asks) {
                asks[level.price] = level.quantity
              }

              this.books[market] = {
                bids,
                asks,
              }
              this.updateWsState(m.channel)
            } else if (update_type === 'delta') {
              const newBuys = m.result.filter((order: any) => order.side === 'buy')
              const newSells = m.result.filter((order: any) => order.side === 'sell')
              // console.log('new buys', newBuys)
              const bids = this.processOrderSide(this.books[market].bids, newBuys)
              const asks = this.processOrderSide(this.books[market].asks, newSells)

              this.books[market] = {
                bids,
                asks,
              }
            } else {
              console.log('unknown update_type', update_type)
            }
            const info = this.marketsInfo[market]
            const book = this.humanizeOrderbook(this.books[market], info)
            this.events.emit('orderbook', market, book)
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
              const keys = Object.keys(result)
              for (const key of keys) {
                const r = result[key]
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
            this.events.emit('balances', this.balances)
            break
          case 'orders':
            if (update_type === 'full_state') {
              const openOrders = {}
              for (const o of result.open_orders) {
                const { market_id } = o
                const info = this.marketsInfo[market_id]
                if (!info) continue
                const order = humanizeOrder(o, info)

                if (!openOrders[market_id]) {
                  openOrders[market_id] = []
                }
                openOrders[market_id].push(order)
              }
              this.openOrders = openOrders
              this.updateWsState(m.channel)
            } else {
              for (const o of result) {
                const { market_id } = o
                if (o.type === 'update') {
                  const { status } = o
                  if (!this.openOrders[market_id]) return
                  const index = this.openOrders[market_id].findIndex(
                    order => order.id === o.id
                  )
                  if (status === 'cancelled') {
                    this.openOrders[market_id].splice(index, 1)
                  } else {
                    const info = this.marketsInfo[market_id]
                    if (!info) continue
                    const order = humanizeOrder(o, info)
                    this.openOrders[market_id][index] = order
                  }
                } else if (o.type === 'new') {
                  const info = this.marketsInfo[market_id]
                  if (!info) continue
                  const order = humanizeOrder(o, info)
                  if (!this.openOrders[market_id]) {
                    this.openOrders[market_id] = []
                  }
                  this.openOrders[market_id].push(order)
                } else {
                  console.log('this should not happen', o.type)
                }
              }
            }
            this.events.emit('openOrders', this.openOrders)
            break
          case 'positions':
            if (update_type === 'full_state') {
              for (const p of result.open_positions) {
                const position = humanizePosition(p, this.marketsInfo[p.market_id])
                this.openPositions[p.market_id] = position
              }
              this.updateWsState(m.channel)
            } else {
              for (const p of result) {
                const position = humanizePosition(p, this.marketsInfo[p.market_id])
                if (position.lots === 0) {
                  delete this.openPositions[p.market_id]
                } else {
                  this.openPositions[p.market_id] = position
                }
              }
            }
            this.events.emit('positions', this.openPositions)
            break
          case 'account_trades':
            if (update_type === 'full_state') {
              const fills = []
              for (const f of result) {
                if (!this.marketsInfo[f.market_id]) continue
                const fill = humanizeFill(f, this.marketsInfo[f.market_id])
                fills.push(fill)
              }
              this.last200Fills = fills
              this.updateWsState(m.channel)
            } else {
              const fills = this.last200Fills
              for (const f of result) {
                if (!this.marketsInfo[f.market_id]) continue
                const fill = humanizeFill(f, this.marketsInfo[f.market_id])
                fills.unshift(fill)
              }
              if (fills.length > 200) {
                const slicedFills = fills.slice(0, 200)
                this.last200Fills = slicedFills
              } else {
                this.last200Fills = fills
              }
            }
            this.events.emit('accountTrades', this.last200Fills)
            break
          case 'market_stats':
            // console.log(m.result)
            const markets = Object.keys(m.result)
            for (const market of markets) {
              const stat = m.result[market]
              this.stats[market] = {
                ...m.result[market],
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
  async checkLiveliness(skipAPICheck) {
    const url = 'https://tm-api.carbon.network/status'
    const { result } = (await axios.get(url)).data

    const { latest_block_height, latest_block_time } = result.sync_info

    const now = dayjs().unix()
    const diff = now - dayjs(latest_block_time).unix()

    if (diff > 60) {
      throw new Error('chain is dead')
    }

    if (skipAPICheck) return

    const persistence = (
      await axios.get(
        'https://api.carbon.network/carbon/misc/v1/blocks?pagination.limit=1'
      )
    ).data.blocks[0]

    const { block_height } = persistence
    const heightDifference = new BigNumber(latest_block_height).minus(block_height)

    if (heightDifference.gt(150)) {
      throw new Error(
        `api is lagging behind the chain height by more than ${heightDifference} blocks`
      )
    }
  }
  /* Gets all markets parameters */
  async updateMarketsInfo() {
    const tokensInfo = await this.api.getTokensInfo()
    const res = await this.api.getMarketsInfo(tokensInfo)

    const markets = []
    for (const m of res) {
      this.marketsInfo[m.id] = m
      markets.push(m)
    }
    return this.mapPerpMarkets(markets)
  }

  /* Gets all tokens parameters */
  async updateTokensInfo() {
    const url = `https://${this.baseUrl}.carbon.network/carbon/coin/v1/tokens?pagination.limit=1500`
    const res = (await axios.get(url)).data.tokens
    for (const t of res) {
      const token = mapKeys(t, (v, k) => camelCase(k))
      const tokenInfo = {
        ...token,
        decimals: parseInt(token.decimals),
        chainId: parseInt(token.chainId),
        createdBlockHeight: parseInt(token.createdBlockHeight),
        bridgeId: parseInt(token.bridgeId),
      }

      if (tokenInfo.isActive) {
        this.tokensInfo[tokenInfo.denom] = tokenInfo
      }
    }
    return this.tokensInfo
  }

  async updateMarketsStats(): Promise<void> {
    try {
      const now = dayjs()
      const url = `https://${this.baseUrl}.carbon.network/carbon/marketstats/v1/stats`
      const { marketstats } = (await axios.get(url)).data
      for (const m of marketstats) {
        if (m.market_type === 'futures') {
          const info = this.marketsInfo[m.market_id]
          if (info && info.isActive && dayjs(info.expiryTime) < now) {
            const { basePrecision, quotePrecision } = info
            const markPrice = new BigNumber(m.mark_price).shiftedBy(
              basePrecision - quotePrecision
            )
            const indexPrice = new BigNumber(m.index_price).shiftedBy(
              basePrecision - quotePrecision
            )
            const lastPrice = new BigNumber(m.last_price).shiftedBy(
              basePrecision - quotePrecision
            )
            const day_quote_volume = new BigNumber(m.day_quote_volume).shiftedBy(-18)

            // this.stats[m.market_id] = {
            //   markPrice: markPrice.dp(indexPrice.dp()).toNumber(),
            //   indexPrice: indexPrice.toNumber(),
            //   premiumRate: parseFloat(m.premium_rate),
            //   volume: day_quote_volume.dp(0).toNumber(),
            //   lastPrice: lastPrice.toNumber(),
            // }
          }
        }
      }
    } catch (e) {
      console.log('error fetching market stats', e)
    }
  }

  /**
   * Helper function to retrive all perp markets and assign the underlying market symbol as a key
   */

  mapPerpMarkets(markets): PerpMarketParams[] {
    const marketsList = []
    const perps = {}
    for (const marketInfo of markets) {
      // const marketInfo = mapKeys(market, (v, k) => camelCase(k))
      if (
        marketInfo.marketType === 'futures' &&
        marketInfo.description.includes('Perpetual') &&
        marketInfo.isActive
      ) {
        const denom = marketInfo.base
        const symbol = this.tokensInfo[denom].symbol.toUpperCase()
        // const key = marketInfo.displayName.split('_')[0]
        this.marketIdtoSymbol[marketInfo.id] = symbol
        perps[symbol] = marketInfo
        this.oraclesIdtoSymbol[marketInfo.indexOracleId] =
          // marketInfo.displayName.split('_')[0]
          symbol
        marketsList.push({ ...marketInfo, symbol })
      }
    }
    this.perpMarkets = perps
    return marketsList
  }

  /**
   * Gets the market info for a given ticker
   * @param symbol ticker
   */
  getPerpMarketInfo(symbol: string) {
    if (this.perpMarkets[symbol]) {
      return this.perpMarkets[symbol.toUpperCase()]
    }
    throw new Error('market not found')
  }

  /* GETTERS */

  getOrderBook(symbol: string): Book {
    const { id } = this.getPerpMarketInfo(symbol)
    if (!this.books[id]) {
      throw new Error(`${symbol} not found in order books. Did you subscribe?`)
    }
    const rawBook = this.books[id]
    const info = this.marketsInfo[id]
    return this.humanizeOrderbook(rawBook, info)
  }

  getBalance(denom: string): Balance {
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

  // @note: uses index price to estimate the uPnL instead of mark price
  getPositions(): Position[] {
    const positions = []
    for (const market of Object.keys(this.openPositions)) {
      const position = this.openPositions[market]
      position.symbol = this.marketIdtoSymbol[market]
      if (!this.stats[market]) {
        positions.push(position)
      } else {
        const info = this.marketsInfo[market]

        position.markPrice = new BigNumber(this.stats[market].mark_price)
          .shiftedBy(info.basePrecision - info.quotePrecision)
          .toNumber()

        position.unrealizedPnl =
          position.lots > 0
            ? (position.markPrice - position.avgEntryPrice) * position.lots
            : (position.avgEntryPrice - position.markPrice) * position.lots

        positions.push(position)
      }
    }
    return positions
  }

  getPosition(symbol: string): Position {
    const empty = {
      symbol,
      allocatedMargin: 0,
      avgEntryPrice: 0,
      lots: 0,
      side: '',
      marketId: '',
      market: '',
    }

    if (!this.perpMarkets[symbol]) return empty

    const { id } = this.perpMarkets[symbol]

    if (this.openPositions[id]) {
      const position = this.openPositions[id]
      position.symbol = symbol
      position.markPrice = parseFloat(this.stats[id].mark_price)

      position.unrealizedPnl =
        position.lots > 0
          ? (position.markPrice - position.avgEntryPrice) * position.lots
          : (position.avgEntryPrice - position.markPrice) * position.lots
      return position
    }

    return empty
  }

  getOpenOrders(symbol?: string): Order[] {
    const orders = []
    const markets = Object.keys(this.openOrders)
    for (const m of markets) {
      this.openOrders[m].forEach(order => {
        orders.push({ ...order, symbol: this.marketIdtoSymbol[m] })
      })
    }

    if (symbol) {
      return orders.filter(order => order.symbol === symbol)
    }
    return orders
  }

  async getUserTrades(symbol?: string): Promise<UserFill[]> {
    // uses the API endpoint instead of GRPC as the API endpoint is more flexible
    let url = `https://api.carbon.network/carbon/broker/v1/trades?pagination.limit=200&pagination.count_total=false&address=${this.address}`
    if (symbol) {
      const marketId = this.getPerpMarketInfo(symbol).id
      url = `${url}&market=${marketId}`
    }

    const { trades } = (await axios.get(url)).data
    const fills = trades.map(fill => {
      const symbol = this.marketIdtoSymbol[fill.market_id]
      const hFill = humanizeUserFill(fill, this.marketsInfo[fill.market_id], this.address)
      return { ...hFill, symbol }
    })
    return fills
  }

  async getTrades(symbol?: string): Promise<Fill[]> {
    // uses the API endpoint instead of GRPC as the API endpoint is more flexible
    let url = `https://api.carbon.network/carbon/broker/v1/trades?pagination.limit=200&pagination.count_total=false`
    if (symbol) {
      const marketId = this.getPerpMarketInfo(symbol).id
      url = `${url}&market=${marketId}`
    }

    const { trades } = (await axios.get(url)).data
    const fills = trades.map(fill => {
      const symbol = this.marketIdtoSymbol[fill.market_id]
      const hFill = humanizeFill(fill, this.marketsInfo[fill.market_id])
      return { ...hFill, symbol }
    })
    return fills
  }

  async getMarketStats(): Promise<MarketStats[]> {
    // await this.updateMarketsStats()
    const usageMultiplier = await this.api.getUsageMultiplier()
    const perpPools = await this.api.getPerpPools()
    const poolStats = (
      await axios.get('https://api.carbon.network/carbon/perpspool/v1/pools/pool_info')
    ).data.pools
    // funding rate interval
    const interval = (
      await axios.get('https://api.carbon.network/carbon/market/v1/controlled_params')
    ).data.controlled_params.perpetuals_funding_interval
    const intervalRate = new BigNumber(interval.slice(0, -1))

    const poolsConfig = {}
    for (const p of perpPools) {
      const { pool, registered_markets } = p
      const maxBorrowFee = new BigNumber(pool.base_borrow_fee_per_funding_interval)
      const vaultAddress = pool.vault_address
      // get pool utilisation rate
      const positions = (
        await axios.get(
          `https://api.carbon.network/carbon/position/v1/positions?address=${vaultAddress}&status=open`
        )
      ).data.positions

      for (const mkt of registered_markets) {
        const { market_id, max_liquidity_ratio, quote_shape, borrow_fee_multiplier } = mkt
        const totalQuoteRatio = quote_shape.reduce((prev: BigNumber, quote) => {
          return prev.plus(quote.quote_amount_ratio)
        }, new BigNumber(0))
        const borrowFeeMultiplier = new BigNumber(borrow_fee_multiplier)
        poolsConfig[market_id] = {
          maxLiquidityRatio: new BigNumber(max_liquidity_ratio),
          borrowFeeMultiplier: new BigNumber(borrow_fee_multiplier),
          totalQuoteRatio,
        }

        const maxLiquidityRatio = new BigNumber(max_liquidity_ratio)
        const poolNav = this.api.getPoolNav(poolStats, pool.id)
        const allocatedLiquidity = maxLiquidityRatio.times(totalQuoteRatio).times(poolNav)

        const position = positions.find(pos => pos.market_id === market_id)
        if (!position) continue

        const marketInfo = this.marketsInfo[market_id]
        const positionHuman = humanizePosition(position, marketInfo)
        const positionMargin = position
          ? new BigNumber(positionHuman.allocatedMargin)
          : new BigNumber(0)
        const avgEntryPrice = position
          ? new BigNumber(positionHuman.avgEntryPrice)
          : new BigNumber(0)
        const lots = position ? new BigNumber(positionHuman.lots) : new BigNumber(0)
        // // get mark price to calculate uPnL
        const markPrice = new BigNumber(this.stats[market_id].markPrice)
        const upnl = markPrice.minus(avgEntryPrice).times(lots)
        const positionValue = positionMargin.plus(upnl)

        let utilizationRate = positionValue.div(allocatedLiquidity)

        if (utilizationRate.gt(1)) {
          utilizationRate = new BigNumber(1)
        }
        if (utilizationRate.lt(0)) {
          utilizationRate = new BigNumber(0)
        }

        const marketLiquidityUsageMultiplier = usageMultiplier[market_id]

        // derive borrow rate
        let borrowRate = utilizationRate
          .times(borrowFeeMultiplier)
          .times(marketLiquidityUsageMultiplier)
          .times(maxBorrowFee)
        if (lots.isPositive()) {
          borrowRate = borrowRate.times(new BigNumber(-1))
        }
        // TODO: derive premium rate
        // premium rate
        const rawPremium = this.stats[market_id].premiumRate

        const premiumRate = new BigNumber(rawPremium).div(
          new BigNumber(86400).div(intervalRate)
        )
        const premiumRateAnnual = premiumRate
          .times(60)
          .times(24 * 365)
          .times(100)
        const borrowRateAnnual = borrowRate
          .times(60)
          .times(24 * 365)
          .times(100)
        const rate = premiumRateAnnual.plus(borrowRateAnnual)
        // const symbol = this.marketIdtoSymbol[market_id]
        this.stats[market_id].fundingRate = rate.dp(2).toNumber()
      }
    }
    const markets = Object.keys(this.stats)

    const stats = markets.map(m => {
      const premiumRate = new BigNumber(this.stats[m].premiumRate).div(
        new BigNumber(86400).div(intervalRate)
      )
      const premiumRateAnnual = new BigNumber(premiumRate)
        .times(60)
        .times(24 * 365)
        .times(100)
      return {
        fundingRate: this.stats[m].fundingRate
          ? this.stats[m].fundingRate
          : premiumRateAnnual.dp(2).toNumber(),
        marketId: m,
        indexPrice: this.stats[m].indexPrice,
        lastPrice: this.stats[m].lastPrice,
        markPrice: this.stats[m].markPrice,
        symbol: this.marketIdtoSymbol[m],
        volume: this.stats[m].volume,
      }
    })
    stats.sort((a, b) => {
      return b.volume - a.volume
    })

    return stats
  }

  async getMarketsLeverage(): Promise<UserLeverage[]> {
    const leverages = []
    const { marketLeverages } = await this.sdk.query.leverage.LeverageAll({
      address: this.address,
    })

    for (const i of marketLeverages) {
      const { marketId, leverage } = i
      const symbol = this.marketIdtoSymbol[marketId]

      if (symbol) {
        leverages.push({
          symbol,
          leverage: new BigNumber(leverage).shiftedBy(-18).dp(2).toNumber(),
        })
      }
    }

    return leverages
  }

  /* HELPER FUNCTIONS FOR ORDER SUBMISSION */

  roundPrice(price, side, market) {
    const { tickSize } = this.marketsInfo[market]
    // if (side === OrderSide.Sell)
    //   return price.div(tickSize).integerValue(BigNumber.ROUND_CEIL).times(tickSize)
    return price.div(tickSize).integerValue().times(tickSize)
  }

  roundQuantity(quantity, market) {
    const { lotSize } = this.marketsInfo[market]
    return quantity.div(lotSize).integerValue().times(lotSize)
  }

  /* SIGNER FUNCTIONS */

  
  createOrderMsg(params: OrderParams) {
    const market = this.perpMarkets[params.symbol].id
    const { basePrecision, quotePrecision } = this.perpMarkets[params.symbol]

    let quantity = this.roundQuantity(new BigNumber(params.quantity), market)
    quantity = new BigNumber(quantity).shiftedBy(basePrecision).toString(10)

    let price = this.roundPrice(new BigNumber(params.price), params.side, market)
    const priceAdjustment = basePrecision - quotePrecision
    price = new BigNumber(price).shiftedBy(-priceAdjustment).shiftedBy(18).toString()

    const tif = params.type === OrderType.Limit ? 'gtc' : 'ioc'
    const value = MsgCreateOrder.fromPartial({
      creator: this.sdk.wallet.bech32Address,
      isReduceOnly: typeof params.isReduceOnly === 'undefined' ? false : params.isReduceOnly,
      isPostOnly: typeof params.isPostOnly === 'undefined' ? false : params.isPostOnly,
      marketId: market,
      orderType: params.type,
      price,
      quantity,
      side: params.side,
      referralAddress: params.referrer_address ? params.referrer_address : '',
      referralCommission: 15,
      referralKickback: 0,
      timeInForce: params.tif ? params.tif : tif,
    })
    const message = {
      typeUrl: CarbonTx.Types.MsgCreateOrder,
      value,
    }
    return message
  }
  // @note: order id is not returned in the transaction response.
  // Use getOpenOrders to get the order id
  async submitOrder(params: OrderParams): Promise<Txn> {
    const message = this.createOrderMsg(params)
    const tx = (await this.sdk.wallet.sendTx(message)) as any

    if (tx.code === 0) {
      // tx succeeded
      return {
        success: true,
        txHash: tx.transactionHash,
        message: '',
      }
    }
    return {
      success: false,
      txHash: tx.transactionHash,
      message: '', // TODO: provide more details
    }
  }

  async cancelAll(symbol: string): Promise<Txn> {
    const id = this.perpMarkets[symbol].id
    const tx = (await this.sdk.wallet.sendTx({
      typeUrl: CarbonTx.Types.MsgCancelAll,
      value: {
        creator: this.sdk.wallet.bech32Address,
        market: id,
      },
    })) as any

    if (tx.code === 0) {
      // tx succeeded
      return {
        success: true,
        txHash: tx.transactionHash,
        message: '',
      }
    }
    return {
      success: false,
      txHash: tx.transactionHash,
      message: '', // TODO: provide more details
    }
  }

  async cancelOrder(orderId: string): Promise<Txn> {
    const tx = (await this.sdk.wallet.sendTx({
      typeUrl: CarbonTx.Types.MsgCancelOrder,
      value: {
        creator: this.sdk.wallet.bech32Address,
        orderId,
      },
    })) as any

    if (tx.code === 0) {
      // tx succeeded
      return {
        success: true,
        txHash: tx.transactionHash,
        message: '',
      }
    }
    return {
      success: false,
      txHash: tx.transactionHash,
      message: '', // TODO: provide more details
    }
  }

  async updateLeverage(symbol: string, leverage: number): Promise<Txn> {
    const tx = (await this.sdk.wallet.sendTx({
      typeUrl: CarbonTx.Types.MsgSetLeverage,
      value: {
        creator: this.sdk.wallet.bech32Address,
        marketId: this.perpMarkets[symbol].id,
        leverage: new BigNumber(leverage).shiftedBy(18).toString(),
      },
    })) as any

    if (tx.code === 0) {
      // tx succeeded
      return {
        success: true,
        txHash: tx.transactionHash,
        message: '',
      }
    }
    return {
      success: false,
      txHash: tx.transactionHash,
      message: '', // TODO: provide more details
    }
  }

  async depositUSDC(amount: number, network: DepositSupportedNetworks): Promise<Txn> {
    const addressBytes = SWTHAddress.getAddressBytes(
      this.sdk?.wallet?.bech32Address!,
      this.sdk?.network!
    )

    let token = null

    try {
      if (network === 'arb') {
        token = this.tokensInfo['usdc.1.19.f9afe3']
        const ethAddress = await this.evmSigners.arb.getAddress()
        const { decimals } = token
        const tx = await this.sdk?.arbitrum.lockDeposit({
          ethAddress,
          signer: this.evmSigners.arb,
          address: addressBytes,
          amount: new BigNumber(amount).shiftedBy(decimals),
          token,
        })

        return {
          success: true,
          txHash: tx.hash,
          message: '', // TODO: provide more details
        }
      } else if (network === 'eth') {
        token = this.tokensInfo['usdc.1.2.343151']
        const ethAddress = await this.evmSigners.eth.getAddress()
        const { decimals } = token
        const tx = await this.sdk?.eth.lockDeposit({
          ethAddress,
          signer: this.evmSigners.eth,
          address: addressBytes,
          amount: new BigNumber(amount).shiftedBy(decimals),
          token,
        })

        return {
          success: true,
          txHash: tx.hash,
          message: '', // TODO: provide more details
        }
      } else {
        throw new Error('network not supported')
      }
    } catch (e) {
      return {
        success: false,
        txHash: '',
        message: e, // TODO: provide more details
      }
    }
  }

  async withdrawUSDC(amount: number, network: DepositSupportedNetworks) {
    let denom = null
    let toAddress = ''
    if (network === 'arb') {
      denom = 'usdc.1.19.f9afe3'
      toAddress = await this.evmSigners.arb.getAddress()
    } else if (network === 'eth') {
      denom = 'usdc.1.2.343151'
      toAddress = await this.evmSigners.eth.getAddress()
    } else {
      throw new Error('network not supported')
    }
    const BN_ZERO = new BigNumber(0)

    try {
      const tx = (await this.sdk.coin.createWithdrawal({
        denom,
        toAddress: toAddress.substring(2),
        amount: this.sdk.token.toUnitless(denom, new BigNumber(amount)) ?? BN_ZERO,
        feeAmount: BN_ZERO, // TODO: pay fees
        feeAddress: AddressUtils.SWTHAddress.encode(this.sdk.networkConfig.feeAddress, {
          network: this.sdk.network,
        }),
        feeDenom: denom,
      })) as any
      return {
        success: true,
        txHash: tx.transactionHash,
        message: '', // TODO: provide more details
      }
    } catch (e) {
      return {
        success: false,
        txHash: '',
        message: e,
      }
    }
  }
}
