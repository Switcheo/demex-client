import camelCase from 'lodash.camelcase'
import mapKeys from 'lodash.mapkeys'
import axios from 'axios'
import BigNumber from 'bignumber.js'

import {
  AccountInfoResponse,
  MappedAddress,
  GrantAccountParams,
  MarketStats,
  PerpMarketParams,
  Position,
  TokensInfo,
  WalletBalance,
  Token,
  MarketLeverage,
  Book,
  UsageMultiplier,
} from './types'
import {
  AuthorizedSignlessMsgs,
  camelCaseKeys,
  constructEIP712Tx,
  convertKeysToSnakeCase,
  humanizePosition,
  toHumanPrice,
  toHumanQuantity,
} from './utils'
import { MsgSetLeverage } from 'carbon-js-sdk/lib/codec/Switcheo/carbon/leverage/tx'
import { MsgWithdraw } from 'carbon-js-sdk/lib/codec/Switcheo/carbon/coin/tx'
import { CarbonSDK, CarbonTx, CarbonWallet } from 'carbon-js-sdk'
import { BaseAccount } from 'carbon-js-sdk/lib/codec/cosmos/auth/v1beta1/auth'
import { toBase64, fromHex, fromBase64 } from '@cosmjs/encoding'
import {
  EncodeObject,
  makeAuthInfoBytes,
  encodePubkey,
  TxBodyEncodeObject,
  Registry,
} from '@cosmjs/proto-signing'
import {
  encodeAnyEthSecp256k1PubKey,
  parseChainId,
} from 'carbon-js-sdk/lib/util/ethermint'
import { Int53 } from '@cosmjs/math'
import { DEFAULT_FEE } from 'carbon-js-sdk/lib/constant'
import { TxBody, TxRaw } from 'carbon-js-sdk/lib/codec/cosmos/tx/v1beta1/tx'
import { parseBN } from 'carbon-js-sdk/lib/util/number'
import { MsgGrant } from 'carbon-js-sdk/lib/codec/cosmos/authz/v1beta1/tx'
import { MsgGrantAllowance } from 'carbon-js-sdk/lib/codec/cosmos/feegrant/v1beta1/tx'
import { GenericAuthorization } from 'carbon-js-sdk/lib/codec/cosmos/authz/v1beta1/authz'
import { GrantTypes } from 'carbon-js-sdk/lib/provider/amino/types/grant'
import {
  AllowedMsgAllowance,
  BasicAllowance,
} from 'carbon-js-sdk/lib/codec/cosmos/feegrant/v1beta1/feegrant'
import { stripHexPrefix } from 'carbon-js-sdk/lib/util/generic'
import { ExtensionOptionsWeb3Tx } from 'carbon-js-sdk/lib/codec/ethermint/types/v1/web3'
import { SignMode } from 'carbon-js-sdk/lib/codec/cosmos/tx/signing/v1beta1/signing'
import { makeSignDoc } from '@cosmjs/amino/build'
import { registry as TypesRegistry } from 'carbon-js-sdk/lib/codec'
import {
  MsgCancelOrder,
  MsgCreateOrder,
  MsgEditOrder,
} from 'carbon-js-sdk/lib/codec/Switcheo/carbon/order/tx'
import { MsgSetMargin } from 'carbon-js-sdk/lib/codec/Switcheo/carbon/position/tx'

const registry: Registry = TypesRegistry as Registry

export class CarbonAPI {
  async getTokensInfo(): Promise<TokensInfo> {
    const tokens = {}
    const url = `https://api.carbon.network/carbon/coin/v1/tokens?pagination.limit=1500`
    const res = (await axios.get(url)).data.tokens

    for (const token of res) {
      const tokenInfo = mapKeys(token, (v, k) => camelCase(k))
      tokenInfo.decimals = parseInt(tokenInfo.decimals)
      tokenInfo.bridgeId = parseInt(tokenInfo.bridgeId)
      tokenInfo.chainId = parseInt(tokenInfo.chainId)
      tokenInfo.createdBlockHeight = parseInt(tokenInfo.createdBlockHeight)
      tokens[tokenInfo.denom] = tokenInfo
    }
    return tokens
  }

  async getMarketsInfo(tokensInfo: TokensInfo): Promise<PerpMarketParams[]> {
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
          tickSize: toHumanPrice(market.tickSize, market),
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
        const baseTokenId = market.base
        // console.log(baseTokenId, tokensInfo[baseTokenId])
        const key = tokensInfo[baseTokenId].symbol
        // let key = marketInfo.displayName.split('_')[0]
        // if (key === 'BTC') key = 'WBTC'
        // if (key === 'NEO') key = 'bNEO'
        marketsList.push({ ...marketInfo, symbol: key })
      }
    }
    return marketsList
  }

  async getUserLeverage(address, market): Promise<number> {
    market = market.replace('/', '%252F')
    const url = `https://api.carbon.network/carbon/leverage/v1/leverages/${address}/${market}`
    const res = parseFloat((await axios.get(url)).data.market_leverage.leverage)
    return res
  }

  async getPositions(address: string): Promise<Position[]> {
    const tokensInfo = await this.getTokensInfo()

    const marketsParams = await this.getMarketsInfo(tokensInfo)
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

  async getOpenOrders(address: string): Promise<any> {
    const url = `https://api.carbon.network/carbon/order/v1/orders?order_status=open&address=${address}`
    console.log('url', url)
    const res = (await axios.get(url)).data.orders
    return res
  }

  async getMarketStats(marketParams: PerpMarketParams[]): Promise<MarketStats[]> {
    const tokensInfo = await this.getTokensInfo()
    const marketsInfo = await this.getMarketsInfo(tokensInfo)
    const url = `https://api.carbon.network/carbon/marketstats/v1/stats`
    const res = (await axios.get(url)).data.marketstats
    const stats = res.map(s => {
      return mapKeys(s, (v, k) => camelCase(k))
    })
    // funding rate interval
    const interval = (
      await axios.get('https://api.carbon.network/carbon/market/v1/controlled_params')
    ).data.controlled_params.perpetuals_funding_interval
    const intervalRate = new BigNumber(interval.slice(0, -1))
    const poolPositions = {}

    const usageMultiplier = await this.getUsageMultiplier()
    const perpPools = await this.getPerpPools()
    const poolStats = (
      await axios.get('https://api.carbon.network/carbon/perpspool/v1/pools/pool_info')
    ).data.pools

    for (const s of stats) {
      const marketParam = marketParams.find(p => p.id === s.marketId)
      if (!marketParam) continue

      const premiumRate = new BigNumber(s.premiumRate).div(
        new BigNumber(86400).div(intervalRate)
      )
      const premiumRateAnnual = new BigNumber(premiumRate)
        .times(60)
        .times(24 * 365)
        .times(100)

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
      s.premiumRate = premiumRateAnnual.toNumber()

      // borrow rate
      // find pool id
      const poolData = getPoolId(s.marketId, perpPools)
      let borrowRate = new BigNumber(0)
      let combinedFundingRate = new BigNumber(0)
      if (poolData) {
        const { pool, mkt } = poolData
        const { market_id, max_liquidity_ratio, quote_shape, borrow_fee_multiplier } = mkt
        const totalQuoteRatio = quote_shape.reduce((prev: BigNumber, quote) => {
          return prev.plus(quote.quote_amount_ratio)
        }, new BigNumber(0))
        const borrowFeeMultiplier = new BigNumber(borrow_fee_multiplier)
        const maxLiquidityRatio = new BigNumber(max_liquidity_ratio)
        const poolNav = this.getPoolNav(poolStats, pool.id)
        if (poolNav) {
          const allocatedLiquidity = maxLiquidityRatio
            .times(totalQuoteRatio)
            .times(poolNav)
          console.log('pool', pool)
          const maxBorrowFee = new BigNumber(pool.base_borrow_fee_per_funding_interval)
          const vaultAddress = pool.vault_address
          // get pool utilisation rate
          if (!poolPositions[vaultAddress]) {
            poolPositions[vaultAddress] = (
              await axios.get(
                `https://api.carbon.network/carbon/position/v1/positions?address=${vaultAddress}&status=open`
              )
            ).data.positions
          }
          const position = poolPositions[vaultAddress].find(
            pos => pos.market_id === market_id
          )
          if (position) {
            const marketInfo = marketsInfo.find(m => m.id === market_id)
            const positionHuman = humanizePosition(position, marketInfo)
            const positionMargin = position
              ? new BigNumber(positionHuman.allocatedMargin)
              : new BigNumber(0)
            const avgEntryPrice = position
              ? new BigNumber(positionHuman.avgEntryPrice)
              : new BigNumber(0)
            const lots = position ? new BigNumber(positionHuman.lots) : new BigNumber(0)
            const markPrice = new BigNumber(
              stats.find(s => s.marketId === market_id).markPrice
            )
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
            borrowRate = utilizationRate
              .times(borrowFeeMultiplier)
              .times(marketLiquidityUsageMultiplier)
              .times(maxBorrowFee)
            if (lots.isPositive()) {
              borrowRate = borrowRate.times(new BigNumber(-1))
            }
          }
        }
      }
      const borrowRateAnnual = borrowRate
        .times(60)
        .times(24 * 365)
        .times(100)

      console.log(s.marketId)
      console.log('borrowRate', borrowRateAnnual.toNumber())
      console.log('premiumRateAnnual', premiumRateAnnual.toNumber())
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

  async getOrderbook(market: string, marketParam: PerpMarketParams): Promise<Book> {
    const url = `https://api.carbon.network/carbon/book/v1/books/${market.replace(
      '/',
      '%252F'
    )}`
    const res = (await axios.get(url)).data.book

    const { bids, asks } = res
    const book = {
      bids: bids.map(b => {
        return {
          price: toHumanPrice(b.price, marketParam),
          quantity: toHumanQuantity(b.total_quantity, marketParam.basePrecision),
        }
      }),
      asks: asks.map(a => {
        return {
          price: toHumanPrice(a.price, marketParam),
          quantity: toHumanQuantity(a.total_quantity, marketParam.basePrecision),
        }
      }),
    }
    return book
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

  async getMarketsLeverage(address: string): Promise<MarketLeverage[]> {
    const url = `https://api.carbon.network/carbon/leverage/v1/leverages/${address}`
    const res = (await axios.get(url)).data.market_leverages
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

  withdrawMsg(
    fromAddress: string,
    toAddress: string,
    denom: string,
    amount: string,
    feeAddress: string
  ) {
    // fee for relayer to cover gas
    const feeAmount = '0'
    const feeDenom = 'swth'

    const value = MsgWithdraw.fromPartial({
      creator: fromAddress,
      toAddress: stripHexPrefix(toAddress),
      denom,
      amount,
      feeAmount,
      feeAddress,
      feeDenom,
    })

    const msg = {
      type: 'carbon/MsgWithdraw',
      value,
    }
    return msg
  }

  orderMsg(
    fromAddress: string,
    marketId,
    quantity: string,
    price: string,
    side: string,
    timeInForce: string,
    orderType: string
  ) {
    const value = MsgCreateOrder.fromPartial({
      creator: fromAddress,
      isPostOnly: false,
      isReduceOnly: false,
      marketId,
      orderType,
      quantity,
      side,
      referralAddress: 'swth14l98pp2z9wqmarzlqm48qgusxxj8wywmfe6qmy',
      referralCommission: 30,
      referralKickback: 0,
      timeInForce,
      ...(orderType === 'limit' && { price }),
    })

    const msg = {
      type: 'order/CreateOrder',
      value,
    }
    return msg
  }

  cancelMsg(fromAddress: string, id: string) {
    const value = MsgCancelOrder.fromPartial({
      creator: fromAddress,
      id,
    })
    const msg = {
      type: 'order/CancelOrder',
      value,
    }
    return msg
  }

  editOrderMsg(
    fromAddress: string,
    orderId: string,
    quantity: string,
    price: string,
    stopPrice: string
  ) {
    const value = MsgEditOrder.fromPartial({
      creator: fromAddress,
      id: orderId,
      quantity,
      stopPrice,
      price,
    })

    const msg = {
      type: 'order/EditOrder',
      value,
    }
    return msg
  }

  setMarginMsg(fromAddress: string, marketId: string, margin: string) {
    const value = MsgSetMargin.fromPartial({
      creator: fromAddress,
      marketId,
      margin,
    })

    const msg = {
      type: 'position/SetMargin',
      value,
    }
    return msg
  }

  // combine msg with fee, evmChainId, memo, accountNumber, sequence
  async getEip712Message(
    // msg: EncodeObject,
    msg: any,
    from: string,
    chain_id: string,
    memo: string
  ) {
    const { account_number, sequence } = await this.getAccountInfo(from)

    const fee = {
      amount: [
        {
          amount: '0',
          denom: 'swth',
        },
      ],
      gas: DEFAULT_FEE.gas, // '10000000'
    }
    return {
      msg0: msg, // hardcoded as only 1 withdraw msg
      fee, // MsgWithdraw gas_cost = 0?
      chain_id,
      memo,
      account_number,
      sequence,
    }
  }

  async makeEIP712Tx(msg: any, typeUrl: string, from: string, memo: string) {
    const { pub_key, sequence, account_number } = await this.getAccountInfo(from) // bad to fetch twice
    const fee = {
      // amount: [{ amount: '10000000', denom: 'swth' }],
      amount: [{ amount: '10000000', denom: 'swth' }],
      gas: '10000000',
    }
    const evmChainId = 'carbon_9790-1'
    const snakeCaseMsg = convertKeysToSnakeCase(msg)
    const stdSignDoc = makeSignDoc(
      [snakeCaseMsg],
      fee,
      evmChainId,
      memo,
      account_number,
      sequence
    )
    const eip712Tx = constructEIP712Tx(stdSignDoc, [typeUrl])
    return { eip712Tx, stdSignDoc }
  }

  // implement getTxRawBinary
  async getTxRawBinary(
    signature: string,
    stdSignDoc: any,
    typeUrl: string,
    from: string,
    memo: string
  ) {
    const { pub_key, sequence, account_number } = await this.getAccountInfo(from) // bad to fetch twice

    const pubkey = encodeAnyEthSecp256k1PubKey(fromBase64(pub_key.key))
    // const sequenceNumber = parseInt(sequence)

    const sigBz = Uint8Array.from(Buffer.from(signature.split('0x')[1], 'hex'))
    const signedAmino = {
      signed: stdSignDoc,
      signature: {
        pub_key: {
          type: '/ethermint.crypto.v1.ethsecp256k1.PubKey',
          value: pub_key,
        },
        // Remove recovery `v` from signature
        signature: Buffer.from(sigBz.slice(0, -1)).toString('base64'),
      },
      // feePayer: accountInfo.swth,
    }
    const signedTxBody = {
      messages: signedAmino.signed.msgs.map(msg => {
        // camcelCase
        const value = camelCaseKeys(msg.value)
        return {
          typeUrl,
          value,
        }
      }),
      memo: signedAmino.signed.memo,
    }

    const signedTxBodyEncodeObject: TxBodyEncodeObject = {
      typeUrl: '/cosmos.tx.v1beta1.TxBody',
      value: signedTxBody,
    }

    const signedTxBodyBytes = registry.encode(signedTxBodyEncodeObject)
    const signedGasLimit = Int53.fromString(signedAmino.signed.fee.gas).toNumber()
    const signedSequence = Int53.fromString(signedAmino.signed.sequence).toNumber()
    const signedAuthInfoBytes = makeAuthInfoBytes(
      [{ pubkey, sequence: signedSequence }],
      signedAmino.signed.fee.amount,
      signedGasLimit,
      undefined,
      undefined,
      127
    )
    const rawTx = TxRaw.fromPartial({
      bodyBytes: signedTxBodyBytes,
      authInfoBytes: signedAuthInfoBytes,
      signatures: [fromBase64(signedAmino.signature.signature)],
    })
    const tx = CarbonWallet.TxRaw.encode(rawTx).finish()
    return Buffer.from(tx).toString('base64')
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

  async broadcastTx(hex: string) {
    const TM_URL = 'https://tm-api.carbon.network/'
    const tx = await axios.post(
      TM_URL,
      JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'broadcast_tx_sync',
        params: {
          tx: hex,
        },
      }),
      { headers: { 'Content-Type': 'application/json' } }
    )
    return tx
  }

  async grantAccount(params: GrantAccountParams) {
    const encodedGrantMsgs = AuthorizedSignlessMsgs.map(msg => {
      const grantMsg = MsgGrant.fromPartial({
        granter: params.granter,
        grantee: params.grantee,
        grant: {
          authorization: {
            typeUrl: GrantTypes.GenericAuthorization,
            value: GenericAuthorization.encode(
              GenericAuthorization.fromPartial({
                msg,
              })
            ).finish(),
          },
          expiration: params.expiry,
        },
      })
      return {
        typeUrl: CarbonTx.Types.MsgGrant,
        value: grantMsg,
      }
    })

    let messages = encodedGrantMsgs

    const encodedAllowanceMsg = [
      {
        typeUrl: CarbonTx.Types.MsgGrantAllowance,
        value: MsgGrantAllowance.fromPartial({
          granter: params.granter,
          grantee: params.grantee,
          allowance: {
            typeUrl: GrantTypes.AllowedMsgAllowance,
            value: AllowedMsgAllowance.encode(
              AllowedMsgAllowance.fromPartial({
                allowance: {
                  typeUrl: GrantTypes.BasicAllowance,
                  value: BasicAllowance.encode(
                    BasicAllowance.fromPartial({
                      expiration: params.expiry,
                    })
                  ).finish(),
                },
                allowedMessages: [CarbonTx.Types.MsgExec],
              })
            ).finish(),
          },
        }),
      },
    ]
    messages.concat(encodedAllowanceMsg)
    return messages
  }

  async getUsageMultiplier(): Promise<UsageMultiplier> {
    const usageMultiplierData = {}
    const usageMultiplier = await axios.get(
      'https://api.carbon.network/carbon/perpspool/v1/markets_liquidity_usage_multiplier'
    )
    for (const mkt of usageMultiplier.data.markets_liquidity_usage_multiplier) {
      const { market_id, multiplier } = mkt
      usageMultiplierData[market_id] = new BigNumber(multiplier)
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
}

function getPoolId(marketId, poolInfo) {
  for (const p of poolInfo) {
    const { registered_markets, pool } = p
    for (const mkt of registered_markets) {
      if (mkt.market_id === marketId) {
        return { pool, mkt }
      }
    }
  }
  return null
}
