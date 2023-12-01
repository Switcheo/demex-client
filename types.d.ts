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

export interface BookSideMap {
  [price: number]: number
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
