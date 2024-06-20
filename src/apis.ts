import camelCase from 'lodash.camelcase'
import mapKeys from 'lodash.mapkeys'
import axios from 'axios'
import BigNumber from 'bignumber.js'
import {
  AccountInfoResponse,
  MarketStats,
  PerpMarketParams,
  Position,
  WalletBalance,
} from './types'
import { humanizePosition } from './utils'
import { MsgSetLeverage } from 'carbon-js-sdk/lib/codec/Switcheo/carbon/leverage/tx'
import { CarbonSDK, CarbonTx, CarbonWallet } from 'carbon-js-sdk'
import { BaseAccount } from 'carbon-js-sdk/lib/codec/cosmos/auth/v1beta1/auth'
import { toBase64, toHex, fromBase64 } from '@cosmjs/encoding'
import { EncodeObject } from '@cosmjs/proto-signing'

export async function getTokens() {
  const tokens = {}
  const url = `https://api.carbon.network/carbon/coin/v1/tokens?pagination.limit=1500`
  const res = (await axios.get(url)).data.tokens

  for (const token of res) {
    const tokenInfo = mapKeys(token, (v, k) => camelCase(k))
    tokens[tokenInfo.denom] = tokenInfo
  }
  return tokens
}

export async function getPerpMarkets(): Promise<PerpMarketParams[]> {
  const perpMarkets = []
  const url = `https://api.carbon.network/carbon/market/v1/markets?pagination.limit=800`
  const res = (await axios.get(url)).data.markets

  for (const market of res) {
    const marketInfo = mapKeys(market, (v, k) => camelCase(k))
    if (
      marketInfo.marketType === 'futures' &&
      marketInfo.description.includes('Perpetual') &&
      marketInfo.isActive
    ) {
      const basePrecision = parseInt(marketInfo.basePrecision)
      const quotePrecision = parseInt(marketInfo.quotePrecision)
      const key = marketInfo.displayName.split('_')[0]
      const lotSize = new BigNumber(marketInfo.lotSize)
        .shiftedBy(-basePrecision)
        .toNumber()
      const tickSize = new BigNumber(marketInfo.tickSize)
        .shiftedBy(basePrecision - quotePrecision)
        .toNumber()
      const minQuantity = new BigNumber(marketInfo.minQuantity)
        .shiftedBy(-basePrecision)
        .toNumber()

      const riskStepSize = new BigNumber(marketInfo.riskStepSize)
        .shiftedBy(-basePrecision)
        .toNumber()
      const maxLiquidationOrderTicket = new BigNumber(
        marketInfo.maxLiquidationOrderTicket
      )
        .shiftedBy(-basePrecision)
        .toNumber()
      const impactSize = new BigNumber(marketInfo.impactSize)
        .shiftedBy(-basePrecision)
        .toNumber()
      perpMarkets.push({
        market: key,
        ...marketInfo,
        lotSize,
        tickSize,
        minQuantity,
        riskStepSize,
        maxLiquidationOrderTicket,
        impactSize,
      })
    }
  }
  return perpMarkets
}

export async function getUserLeverage(address, market): Promise<any> {
  market = market.replace('/', '%252F')
  const url = `https://api.carbon.network/carbon/leverage/v1/leverages/${address}/${market}`
  const res = (await axios.get(url)).data.market_leverage
  return res
}

export async function getPositions(
  address: string,
  marketsParams: PerpMarketParams[]
): Promise<Position[]> {
  const positions: Position[] = []
  const url = `https://api.carbon.network/carbon/position/v1/positions?status=open&address=${address}`
  const res = (await axios.get(url)).data.positions
  for (const market of res) {
    const marketInfo = marketsParams.find(p => p.id === market.market_id)
    // console.log(market.market_id, marketInfo)
    const p = humanizePosition(market, marketInfo)
    positions.push(p)
  }
  return positions
}

export async function getMarketStats(): Promise<MarketStats[]> {
  const url = `https://api.carbon.network/carbon/marketstats/v1/stats`
  const res = (await axios.get(url)).data.marketstats
  const stats = res.map(s => {
    return mapKeys(s, (v, k) => camelCase(k))
  })
  stats.indexPrice = new BigNumber(stats.indexPrice).toNumber()
  stats.markPrice = new BigNumber(stats.markPrice).toNumber()

  return stats
}

export async function getBalances(
  address: string,
  tokenParams: any
): Promise<WalletBalance[]> {
  const url = `https://api.carbon.network/carbon/coin/v1/balances/${address}`
  const res = (await axios.get(url)).data.token_balances
  const balances = []
  for (const token of res) {
    let { denom, available, order, position } = token
    const tokenInfo = tokenParams[denom]
    // console.log(tokenInfo)
    if (!tokenInfo) {
      console.log('token not found', denom)
    }

    available = new BigNumber(available).shiftedBy(-tokenInfo.decimals).toNumber()
    order = new BigNumber(order).shiftedBy(-tokenInfo.decimals).toNumber()
    position = new BigNumber(position).shiftedBy(-tokenInfo.decimals).toNumber()
    const { symbol } = tokenInfo
    balances.push({ symbol, available, order, position, denom })
  }
  return balances
}

export async function getAccountInfo(address: string): Promise<AccountInfoResponse> {
  const url = `https://api.carbon.network/cosmos/auth/v1beta1/account_info/${address}`
  const res = (await axios.get(url)).data.info
  return res
}

export function updateLeverageMsg(
  address: string,
  marketId: string,
  leverage: number
): EncodeObject {
  const value = MsgSetLeverage.fromPartial({
    creator: address,
    marketId,
    leverage: leverage.toString(),
  })
  const msg = {
    typeUrl: CarbonTx.Types.MsgSetLeverage,
    value,
  }
  return msg
}

export async function signAndHex(sdk: CarbonSDK, msgs: EncodeObject[]): Promise<string> {
  const result = await sdk.wallet.query.auth.Account({
    address: sdk.wallet.bech32Address,
  })
  const { accountNumber, sequence, address } = BaseAccount.decode(result.account.value)
  const sequenceStr = sequence.toString()
  const accountNumberStr = accountNumber.toString()
  const signedTx = await sdk.wallet.getSignedTx(
    sdk.wallet.bech32Address,
    msgs,
    parseInt(sequenceStr),
    {}
  )
  return toBase64(signedTx.signatures[0])
}
