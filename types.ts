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
  name: string
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
  block_height: number
  block_created_at: string
  address: string
  side: string
  price: number
  quantity: number
  available: number
  filled: number
  status: string
  order_type: string
  initiator: string
  time_in_force: string
  stop_price: number
  avg_filled_price: number
  referral_address: string
  referral_commission: number
  allocated_margin_denom: string
  allocated_margin_amount: number
  last_updated_block_height: number
  symbol?: string
}

export interface Position {
  market?: string
  address?: string
  side?: string
  opened_block_height?: number
  updated_block_height?: number
  realized_pnl?: number
  max_lots?: number
  total_fee_amount?: number
  avg_allocated_margin?: number
  avg_entry_price: number
  avg_exit_price?: number
  allocated_margin: number
  lots: number
  opened_at?: string
  update_count?: number
  exit_count?: number
  symbol?: string
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
  block_height: string
  block_created_at: string
  market: string
  price: number
  quantity: number
  liquidity: string
  taker_id: string
  taker_side: string
  taker_address: string
  taker_fee_amount: number
  taker_fee_denom: string
  taker_fee_kickback: number
  taker_fee_commission: number
  taker_fee_commission_address: string
  maker_id: string
  maker_side: string
  maker_address: string
  maker_fee_amount: number
  maker_fee_denom: string
  maker_fee_kickback: number
  maker_fee_commission: number
  maker_fee_commission_address: string
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
// export interface ClientOptions {
//   network?: Carbon.Network
//   config?: Partial<NetworkConfig>
// }

// export interface EthNetworkConfig {
//   rpcURL: string
//   wsURL: string
//   payerURL: string
//   lockProxyAddr: string
//   bridgeEntranceAddr: string
//   balanceReader: string
//   byteCodeHash: string
// }
// export interface NeoNetworkConfig {
//   rpcURL: string
//   wrapperScriptHash: string
// }
// export interface N3NetworkConfig {
//   rpcURL: string
//   networkMagic: number
// }
// export interface ZilNetworkConfig {
//   rpcURL: string
//   chainId: number
//   lockProxyAddr: string
//   bridgeEntranceAddr: string
// }
// export interface NetworkConfig {
//   tmRpcUrl: string
//   tmWsUrl: string
//   restUrl: string
//   grpcUrl: string
//   grpcWebUrl: string
//   evmJsonRpcUrl: string
//   evmWsUrl: string
//   insightsUrl: string
//   hydrogenUrl: string
//   wsUrl: string
//   faucetUrl: string
//   Bech32Prefix: string
//   network: Network
//   feeAddress: string
//   eth: EthNetworkConfig
//   bsc: EthNetworkConfig
//   arbitrum: EthNetworkConfig
//   polygon: EthNetworkConfig
//   okc: EthNetworkConfig
//   neo: NeoNetworkConfig
//   n3: N3NetworkConfig
//   zil: ZilNetworkConfig
// }
