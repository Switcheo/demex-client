import axios from 'axios'
import BigNumber from 'bignumber.js'
import { CarbonSDK, CarbonSDKInitOpts, CarbonTx } from 'carbon-js-sdk'
import { MsgCreateOrder } from 'carbon-js-sdk/lib/codec/Switcheo/carbon/order/tx'
import dayjs from 'dayjs'
import Long from 'long'
import camelCase from 'lodash.camelcase'
import mapKeys from 'lodash.mapkeys'
import WebSocket from 'ws'

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
  oraclesIdtoSymbol: { [symbol: string]: string }
  // checks
  initialized: boolean = false
  wsInitialized: boolean
  wsState: string[]
  // market data
  books: { [market: string]: Book }
  stats: {
    [market: string]: {
      premiumRate: number
      markPrice: number
      indexPrice: number
      volume: number
      lastPrice: number
      fundingRate?: number
    }
  }
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
    this.oraclesIdtoSymbol = {}

    // virtualization
    this.books = {}
    this.balances = {}
    this.openOrders = {}
    this.openPositions = {}
    this.last200Fills = []

    // market data
    this.stats = {}
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

    console.log(`wallet address: ${this.address}`)

    await this.updateMarketsInfo()
    await this.updateTokensInfo()
    // this.fetchOraclePrices()
    this.fetchMarketStats()
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
                const { market_id } = o
                const info = this.marketsInfo[market_id]
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
                const { market_id } = o
                if (o.type === 'update') {
                  const { status } = o
                  const index = this.openOrders[market_id].findIndex(
                    order => order.id === o.id
                  )
                  if (status === 'cancelled') {
                    this.openOrders[market_id].splice(index, 1)
                  } else {
                    const info = this.marketsInfo[market_id]
                    const order = humanizeOrder(o, info)
                    this.openOrders[market_id][index] = order
                  }
                } else if (o.type === 'new') {
                  const info = this.marketsInfo[market_id]
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
            break
          case 'positions':
            if (update_type === 'full_state') {
              for (const p of result.open_positions) {
                const position = humanizePosition(p, this.marketsInfo[p.market_id])
                this.openPositions[p.market] = position
              }
              this.updateWsState(m.channel)
            } else {
              for (const p of result) {
                const position = humanizePosition(p, this.marketsInfo[p.market_id])
                this.openPositions[p.market] = position
              }
            }
            break
          case 'account_trades':
            if (update_type === 'full_state') {
              const fills = []
              for (const f of result) {
                const fill = humanizeFill(f, this.marketsInfo[f.market_id])
                fills.push(fill)
              }
              this.last200Fills = fills
              this.updateWsState(m.channel)
            } else {
              const fills = this.last200Fills
              for (const f of result) {
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
      this.marketsInfo[market.id] = marketInfo
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

  async fetchMarketStats(): Promise<void> {
    while (true) {
      try {
        const url = 'https://api.carbon.network/carbon/marketstats/v1/stats'
        const { marketstats } = (await axios.get(url)).data
        for (const m of marketstats) {
          if (m.market_type === 'futures') {
            const info = this.marketsInfo[m.market_id]
            if (info.isActive) {
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

              this.stats[m.market_id] = {
                markPrice: markPrice.dp(indexPrice.dp()).toNumber(),
                indexPrice: indexPrice.toNumber(),
                premiumRate: parseFloat(m.premium_rate),
                volume: day_quote_volume.dp(0).toNumber(),
                lastPrice: lastPrice.toNumber(),
              }
            }
          }
        }
      } catch (e) {
      } finally {
        await sleep(5555)
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
        this.oraclesIdtoSymbol[market.indexOracleId] = market.displayName.split('_')[0]
      }
    }
    this.perpMarkets = perps
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

  /* HELPER FUNCTIONS TO DERIVE FUNDING RATE */

  async getUsageMultiplier(): Promise<UsageMultiplier> {
    const usageMultiplierData = {}
    const usageMultiplier = await axios.get(
      'https://api.carbon.network/carbon/perpspool/v1/markets_liquidity_usage_multiplier'
    )
    for (const mkt of usageMultiplier.data.markets_liquidity_usage_multiplier) {
      const { market, multiplier } = mkt
      usageMultiplierData[market] = new BigNumber(multiplier)
    }

    return usageMultiplierData
  }

  async getPerpPools(): Promise<any> {
    const pools = await axios.get('https://api.carbon.network/carbon/perpspool/v1/pools')
    return pools.data.pools
  }

  getPoolNav(poolStats, id) {
    for (const p of poolStats) {
      if (p.pool_id === id) {
        return new BigNumber(p.total_nav_amount).shiftedBy(-18)
      }
    }
  }

  /* GETTERS */

  getOrderBook(symbol: string): Book {
    const { id } = this.getPerpMarketInfo(symbol)
    if (!this.books[id]) {
      throw new Error(`${symbol} not found in order books. Did you subscribe?`)
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

  // @note: uses index price to estimate the uPnL instead of mark price
  getPositions(): Position[] {
    const positions = []
    for (const market of Object.keys(this.openPositions)) {
      const position = this.openPositions[market]
      position.symbol = this.marketIdtoSymbol[market]
      position.markPrice = this.stats[market].markPrice

      position.unrealizedPnl =
        position.lots > 0
          ? (position.markPrice - position.avgEntryPrice) * position.lots
          : (position.avgEntryPrice - position.markPrice) * position.lots

      positions.push(position)
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
    }

    if (!this.perpMarkets[symbol]) return empty

    const { id } = this.perpMarkets[symbol]

    if (this.openPositions[id]) {
      const position = this.openPositions[id]
      position.symbol = symbol
      position.markPrice = this.stats[id].markPrice

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
    const usageMultiplier = await this.getUsageMultiplier()
    const perpPools = await this.getPerpPools()
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
        const poolNav = this.getPoolNav(poolStats, pool.id)
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
        const symbol = this.marketIdtoSymbol[market_id]
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
        id: m,
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
    if (side === OrderSide.Sell)
      return price.div(tickSize).integerValue(BigNumber.ROUND_CEIL).times(tickSize)
    return price.div(tickSize).integerValue(BigNumber.ROUND_DOWN).times(tickSize)
  }

  roundQuantity(quantity, market) {
    const { lotSize } = this.marketsInfo[market]
    return quantity.div(lotSize).integerValue(BigNumber.ROUND_DOWN).times(lotSize)
  }

  /* SIGNER FUNCTIONS */

  // @note: order id is not returned in the transaction response.
  // Use getOpenOrders to get the order id
  async submitOrder(params: OrderParams): Promise<Txn> {
    const market = this.perpMarkets[params.symbol].id
    const { basePrecision, quotePrecision } = this.perpMarkets[params.symbol]

    const quantityBN = new BigNumber(params.quantity).shiftedBy(basePrecision)
    const quantity = this.roundQuantity(quantityBN, market).toString(10)

    const priceAdjustment = basePrecision - quotePrecision
    const priceBN = new BigNumber(params.price).shiftedBy(-priceAdjustment)
    const price = this.roundPrice(priceBN, params.side, market).shiftedBy(18).toString()

    const value = MsgCreateOrder.fromPartial({
      creator: this.sdk.wallet.bech32Address,
      isPostOnly: false,
      isReduceOnly: typeof params.isPostOnly === 'undefined' ? false : params.isPostOnly,
      marketId: market,
      orderType: 'limit',
      price,
      quantity,
      side: params.side,
      referralAddress: params.referrer_address ? params.referrer_address : '',
      referralCommission: 15,
      referralKickback: 0,
      timeInForce: params.tif ? params.tif : 'gtc',
    })
    const message = {
      typeUrl: CarbonTx.Types.MsgCreateOrder,
      value,
    }

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

  async cancelAll(market: string): Promise<Txn> {
    const id = this.perpMarkets[market].id
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
        market: this.perpMarkets[symbol].id,
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
}
