import BigNumber from 'bignumber.js'
import { CarbonSDKInitOpts } from 'carbon-js-sdk'
import { ethers } from 'ethers'
import { BigNumberish } from '@ethersproject/bignumber'
import { BytesLike } from '@ethersproject/bytes'
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

export interface TokensInfo {
  [id: string]: Token
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
  lotSize: number
  tickSize: number
  minQuantity: number
  base: string
  quote: string
  /** futures only */
  riskStepSize: number
  initialMarginBase: number
  initialMarginStep: number
  maintenanceMarginRatio: number
  maxLiquidationOrderTicket: number
  maxLiquidationOrderDuration?: Duration
  impactSize: number
  markPriceBand?: number
  lastPriceProtectedBand?: number
  isActive?: boolean
  tradingBandwidth?: number
  expiryTime?: Date
  basePrecision: number
  quotePrecision: number
  indexOracleId: string
}

export interface PerpMarketParams extends MarketParams {
  symbol: string
}

export interface PriceLevel {
  price: number
  quantity: number
}

export interface BookSideState {
  [price: string]: string
}

export interface BookState {
  bids: BookSideState
  asks: BookSideState
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

export interface WalletBalance {
  available: number
  order: number
  position: number
  symbol: string
  denom: string
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
  marketId: string
  market: string
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

export interface Trade {
  orderId: string
  marketId: string
  side: string
  quantity: number
  price: number
  feeAmount: number
  feeDenom: string
  address: string
  blockHeight: number
  blockCreatedAt: string
  tradeId: number
}

export interface BookSideMap {
  [price: number]: number
}

export interface WalletInitOpts {
  pkey?: string
  mnemonic?: string
  address?: string
  ethSigner?: ethers.Signer
  arbSigner?: ethers.Signer
  skipAPICheck? : boolean
}

export enum MAINNET_TOKENS {
  USD = 'cgt/1',
  SWTH = 'swth/1',
}

export interface UsageMultiplier {
  [market: string]: BigNumber
}

export interface MarketStats {
  fundingRate?: number
  marketId: string
  indexPrice: number
  lastPrice: number
  markPrice: number
  symbol: string
  volume: number
  openInterest?: number
}

export interface OrderParams {
  symbol: string
  side: OrderSide
  price?: number
  quantity: number
  type?: OrderType
  tif?: OrderTIF
  stopPrice?: string
  referrer_address?: string
  isPostOnly?: boolean
  isReduceOnly?: boolean
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
  symbol: string
  leverage: number
}

export type DepositSupportedNetworks = 'eth' | 'arb'

export interface AccountInfoResponse {
  address: string
  pub_key: {
    '@type': string
    key: string
  }
  account_number: string
  sequence: string
}

export type MappedAddress = string

export interface ClientOpts extends CarbonSDKInitOpts {
  enablePolling?: boolean
}

export interface GrantAccountParams {
  granter: string
  grantee: string
  expiry: Date
}

export interface SimpleMap<T = unknown> {
  [index: string]: T
}
export interface TypedDataField {
  name: string
  type: string
}

export interface TypedDataDomain {
  name?: string
  version?: string
  chainId?: BigNumberish
  verifyingContract?: string
  salt?: BytesLike
}

export interface EIP712Tx {
  readonly types: SimpleMap<TypedDataField[]>
  readonly primaryType: string
  readonly domain: TypedDataDomain
  readonly message: any
}

export interface MarketLeverage {
  market_id: string
  leverage: string
}
