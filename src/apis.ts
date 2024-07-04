import camelCase from 'lodash.camelcase'
import mapKeys from 'lodash.mapkeys'
import axios from 'axios'
import BigNumber from 'bignumber.js'
import {
  AccountInfoResponse,
  MappedAddress,
  MarketStats,
  PerpMarketParams,
  Position,
  WalletBalance,
} from './types'
import { humanizePosition } from './utils'
import { MsgSetLeverage } from 'carbon-js-sdk/lib/codec/Switcheo/carbon/leverage/tx'
import { MsgWithdraw } from 'carbon-js-sdk/lib/codec/Switcheo/carbon/coin/tx'
import { CarbonSDK, CarbonTx, CarbonWallet } from 'carbon-js-sdk'
import { BaseAccount } from 'carbon-js-sdk/lib/codec/cosmos/auth/v1beta1/auth'
import { toBase64, toHex, fromBase64 } from '@cosmjs/encoding'
import { EncodeObject, makeAuthInfoBytes } from '@cosmjs/proto-signing'
import { DEFAULT_FEE } from 'carbon-js-sdk/lib/constant'
import { TxBody, TxRaw } from 'carbon-js-sdk/lib/codec/cosmos/tx/v1beta1/tx' 

export class CarbonAPI {
  async getTokens() {
    const tokens = {}
    const url = `https://api.carbon.network/carbon/coin/v1/tokens?pagination.limit=1500`
    const res = (await axios.get(url)).data.tokens

    for (const token of res) {
      const tokenInfo = mapKeys(token, (v, k) => camelCase(k))
      tokens[tokenInfo.denom] = tokenInfo
    }
    return tokens
  }

  async getUserLeverage(address, market): Promise<number> {
    market = market.replace('/', '%252F')
    const url = `https://api.carbon.network/carbon/leverage/v1/leverages/${address}/${market}`
    const res = parseFloat((await axios.get(url)).data.market_leverage.leverage)
    return res
  }

  async getMarketsInfo(): Promise<PerpMarketParams[]> {
    const url = `https://api.carbon.network/carbon/market/v1/markets?pagination.limit=800`
    const res = (await axios.get(url)).data.markets
    const marketsList = []
    for (const m of res) {
      if (
        m.market_type === 'futures' &&
        m.description.includes('Perpetual') &&
        m.is_active
      ) {
        const market = mapKeys(m, (v, k) => camelCase(k))
        const basePrecision = parseInt(market.basePrecision)
        const quotePrecision = parseInt(market.quotePrecision)
        const marketInfo = {
          ...market,
          basePrecision,
          quotePrecision,
          tickSize: new BigNumber(market.tickSize)
            .shiftedBy(basePrecision - quotePrecision)
            .toNumber(),
          lotSize: new BigNumber(market.lotSize).shiftedBy(-basePrecision).toNumber(),
          minQuantity: new BigNumber(market.minQuantity)
            .shiftedBy(-basePrecision)
            .toNumber(),
          riskStepSize: new BigNumber(market.riskStepSize)
            .shiftedBy(-basePrecision)
            .toNumber(),
          initialMarginBase: new BigNumber(market.initialMarginBase).toNumber(),
          initialMarginStep: new BigNumber(market.initialMarginStep).toNumber(),
          maintenanceMarginRatio: new BigNumber(market.maintenanceMarginRatio).toNumber(),
          maxLiquidationOrderTicket: new BigNumber(market.maxLiquidationOrderTicket)
            .shiftedBy(-basePrecision)
            .toNumber(),
          impactSize: new BigNumber(market.impactSize)
            .shiftedBy(-basePrecision)
            .toNumber(),
          createdBlockHeight: parseInt(market.createdBlockHeight),
        }
        const key = marketInfo.displayName.split('_')[0]
        marketsList.push({ ...marketInfo, market: key })
      }
    }
    return marketsList
  }

  async getPositions(address: string): Promise<Position[]> {
    const marketsParams = await this.getMarketsInfo()
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

  async getMarketStats(marketParams: PerpMarketParams[]): Promise<MarketStats[]> {
    const url = `https://api.carbon.network/carbon/marketstats/v1/stats`
    const res = (await axios.get(url)).data.marketstats
    const stats = res.map(s => {
      return mapKeys(s, (v, k) => camelCase(k))
    })
    // console.log(marketParams)
    for (const s of stats) {
      const marketParam = marketParams.find(p => p.id === s.marketId)
      if (!marketParam) continue
      const diff = marketParam.basePrecision - marketParam.quotePrecision

      s.dayOpen = new BigNumber(s.dayOpen).shiftedBy(diff).toNumber()
      s.dayHigh = new BigNumber(s.dayHigh).shiftedBy(diff).toNumber()
      s.dayLow = new BigNumber(s.dayLow).shiftedBy(diff).toNumber()
      s.dayClose = new BigNumber(s.dayClose).shiftedBy(diff).toNumber()
      s.dayVolume = new BigNumber(s.dayVolume)
        .shiftedBy(-marketParam.basePrecision)
        .toNumber()
      s.dayQuoteVolume = new BigNumber(s.dayQuoteVolume).shiftedBy(-18).toNumber()
      s.indexPrice = new BigNumber(s.indexPrice).shiftedBy(diff).toNumber()
      s.markPrice = new BigNumber(s.markPrice).shiftedBy(diff).toNumber()
      s.lastPrice = new BigNumber(s.lastPrice).shiftedBy(diff).toNumber()
      s.openInterest = new BigNumber(s.openInterest)
        .shiftedBy(-marketParam.basePrecision)
        .toNumber()
    }

    return stats
  }

  async getBalances(address: string, tokenParams: any): Promise<WalletBalance[]> {
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

  async getAccountInfo(address: string): Promise<AccountInfoResponse> {
    const url = `https://api.carbon.network/cosmos/auth/v1beta1/account_info/${address}`
    const res = (await axios.get(url)).data.info
    return res
  }

  async getMappedAddress(address: string): Promise<MappedAddress> {
    const url = `https://api.carbon.network/carbon/evmmerge/v1/mapped_address/${address}`
    const res = (await axios.get(url)).data.mapped_address
    return res
  }

  updateLeverageMsg(address: string, marketId: string, leverage: number): EncodeObject {
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

  withdrawMsg(fromAddress: string, toAddress: string, denom: string, amount: string, feeAddress: string): EncodeObject {

    // use defaults for StdFee
    const feeAmount = DEFAULT_FEE.amount[0].amount
    const feeDenom = DEFAULT_FEE.amount[0].denom

    const value = MsgWithdraw.fromPartial({
      creator: fromAddress,
      toAddress,
      denom,
      amount,
      feeAmount, // default
      feeAddress,
      feeDenom, // default
    });

    const msg = {
      typeUrl: CarbonTx.Types.MsgWithdraw,
      value
    }
    return msg
  }

  // implement geteip712Message
  // combine msg with fee, evmChainId, memo, accountNumber, sequence
  async geteip712Message(msg: EncodeObject, from: string, chain_id: string, memo: string) {
    const { account_number, sequence } = await this.getAccountInfo(from)
    return {
      ...msg,
      fee: DEFAULT_FEE,
      chain_id,
      memo,
      account_number,
      sequence
    }
  }

  // implement getTxRawBinary
  async getTxRawBinary(msg: EncodeObject, signature: string, from: string,  memo: string) {

    const { pub_key, sequence } = await this.getAccountInfo(from) // bad bc fetches twice

    const txBody: TxBody = TxBody.fromPartial({
      messages: [
        msg
      ],
      memo,
  });

    // get TxRaw fromPartial
    const txRaw = TxRaw.fromPartial({
      bodyBytes: TxBody.encode(txBody).finish(),
      authInfoBytes: makeAuthInfoBytes([{ pubkey: pub_key, sequence }], DEFAULT_FEE.amount, DEFAULT_FEE.gas, "", ""), // need to fix pubkey and sequence types
      signatures: [fromBase64(signature)],
    });

    // convert TxRaw to binary to base64
    const binary = TxRaw.encode(txRaw).finish();
    const payload = Buffer.from(binary).toString("base64");

    return payload
  }

  async signAndHex(sdk: CarbonSDK, msgs: EncodeObject[]): Promise<string> {
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
}