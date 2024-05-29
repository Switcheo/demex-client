import BigNumber from 'bignumber.js'

export interface Duration {
  /**
   * Signed seconds of the span of time. Must be from -315,576,000,000
   * to +315,576,000,000 inclusive. Note: these bounds are computed from:
   * 60 sec/min * 60 min/hr * 24 hr/day * 365.25 days/year * 10000 years
   */
  seconds: Long
  /**
   * Signed fractions of a second at nanosecond resolution of the span
   * of time. Durations less than one second are represented with a 0
   * `seconds` field and a positive or negative `nanos` field. For durations
   * of one second or more, a non-zero value for the `nanos` field must be
   * of the same sign as the `seconds` field. Must be from -999,999,999
   * to +999,999,999 inclusive.
   */
  nanos: number
}

export interface Token {
  id: string
  creator: string
  denom: string
  name: string
  symbol: string
  decimals: number
  bridgeId: number
  chainId: number
  tokenAddress: string
  bridgeAddress: string
  isActive: boolean
  createdBlockHeight: number
}

export interface MarketParams {
  id: string
  displayName?: string
  description?: string
  lotSize: string
  tickSize: number
  minQuantity: string
  /** futures only */
  riskStepSize: string
  initialMarginBase: string
  initialMarginStep: string
  maintenanceMarginRatio: string
  maxLiquidationOrderTicket: string
  maxLiquidationOrderDuration?: Duration
  impactSize: string
  markPriceBand?: number
  lastPriceProtectedBand?: number
  isActive?: boolean
  tradingBandwidth?: number
  expiryTime?: Date
  basePrecision: number
  quotePrecision: number
  indexOracleId: string
}

export interface PriceLevel {
  price: number
  quantity: number
}

export interface Book {
  asks: Array<PriceLevel>
  bids: Array<PriceLevel>
}

export interface Balance {
  available: BigNumber
  order: BigNumber
  position: BigNumber
  total: BigNumber
}

export interface Order {
  id: string
  blockHeight: number
  blockCreatedAt: string
  address: string
  side: string
  price: number
  quantity: number
  available: number
  filled: number
  status: string
  orderType: string
  initiator: string
  timeInForce: string
  stopPrice: number
  avgFilledPrice: number
  referralAddress: string
  referralCommission: number
  allocatedMarginDenom: string
  allocatedMarginAmount: number
  lastUpdatedBlockHeight: number
  symbol?: string
}

export interface Position {
  market?: string
  address?: string
  side?: string
  openedBlockHeight?: number
  updatedBlockHeight?: number
  realizedPnl?: number
  totalFeeAmount?: number
  avgEntryPrice: number
  avgExitPrice?: number
  allocatedMargin: number
  lots: number
  openedAt?: string
  updateCount?: number
  exitCount?: number
  symbol?: string
  markPrice?: number
  unrealizedPnl?: number
}

export interface UserFill {
  id: string
  market: string
  side: string
  quantity: number
  price: number
  fee_amount: number
  fee_denom: string
  address: string
  block_height: number
  block_created_at: string
}

export interface Fill {
  id: string
  blockHeight: string
  blockCreatedAt: string
  market: string
  price: number
  quantity: number
  liquidity: string
  takerId: string
  takerSide: string
  takerAddress: string
  takerFeeAmount: number
  takerFeeDenom: string
  takerFeeKickback: number
  takerFeeCommission: number
  takerFeeCommissionAddress: string
  makerId: string
  makerSide: string
  makerAddress: string
  makerFeeAmount: number
  makerFeeDenom: string
  makerFeeKickback: number
  makerFeeCommission: number
  makerFeeCommissionAddress: string
  symbol?: string
}

export interface BookSideMap {
  [price: number]: number
}

export interface WalletInitOpts {
  pkey?: string
  mnemonic?: string
  address?: string
}

export enum MAINNET_TOKENS {
  USD = 'cgt/1',
  SWTH = 'swth/1',
}

export interface UsageMultiplier {
  [market: string]: BigNumber
}

export interface MarketStats {
  fundingRate: number
  id: string
  indexPrice: number
  lastPrice: number
  markPrice: number
  symbol: string
  volume: number
}

export interface OrderParams {
  symbol: string
  side: OrderSide
  price?: number
  quantity: number
  type?: OrderType
  tif?: OrderTIF
  stopPrice?: string
  postOnly?: boolean
  referrer_address?: string
  isPostOnly?: boolean
}

export enum OrderType {
  Limit = 'limit',
  Market = 'market',
  StopLimit = 'stop-limit',
  StopMarket = 'stop-market',
}

export enum OrderTIF {
  GTC = 'gtc',
  FOK = 'fok',
  IOC = 'ioc',
}

export enum OrderSide {
  Buy = 'buy',
  Sell = 'sell',
}

export interface Txn {
  success: boolean
  txHash: string
  message: string
}

export interface UserLeverage {
  market: string
  leverage: number
}
