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
} from './types'
import {
  AuthorizedSignlessMsgs,
  humanizePosition,
  toHumanPrice,
  toHumanQuantity,
} from './utils'
import { MsgSetLeverage } from 'carbon-js-sdk/lib/codec/Switcheo/carbon/leverage/tx'
import { MsgWithdraw } from 'carbon-js-sdk/lib/codec/Switcheo/carbon/coin/tx'
import { CarbonSDK, CarbonTx, CarbonWallet } from 'carbon-js-sdk'
import { BaseAccount } from 'carbon-js-sdk/lib/codec/cosmos/auth/v1beta1/auth'
import { toBase64, fromHex, fromBase64 } from '@cosmjs/encoding'
import { EncodeObject, makeAuthInfoBytes, encodePubkey } from '@cosmjs/proto-signing'
import { encodeAnyEthSecp256k1PubKey } from "carbon-js-sdk/lib/util/ethermint";
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

export class CarbonAPI {
  async getTokensInfo(): Promise<Token[]> {
    const tokens = []
    const url = `https://api.carbon.network/carbon/coin/v1/tokens?pagination.limit=1500`
    const res = (await axios.get(url)).data.tokens

    for (const token of res) {
      const tokenInfo = mapKeys(token, (v, k) => camelCase(k))
      tokenInfo.decimals = parseInt(tokenInfo.decimals)
      tokenInfo.bridgeId = parseInt(tokenInfo.bridgeId)
      tokenInfo.chainId = parseInt(tokenInfo.chainId)
      tokenInfo.createdBlockHeight = parseInt(tokenInfo.createdBlockHeight)
      tokens.push(tokenInfo)
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
        marketsList.push({ ...marketInfo, market: key })
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
    const tokensMap = {}
    for (const token of tokensInfo) {
      tokensMap[token.denom] = token
    }
    const marketsParams = await this.getMarketsInfo(tokensMap)
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

  async getOrderbook(market: string, marketParam: PerpMarketParams): Promise<any> {
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
      // typeUrl: CarbonTx.Types.MsgWithdraw,
      type: "carbon/MsgWithdraw",
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

  // implement getTxRawBinary
  async getTxRawBinary(msg: any, signature: string, from: string, memo: string) {
    const { pub_key, sequence } = await this.getAccountInfo(from) // bad to fetch twice
    const pubkey = encodeAnyEthSecp256k1PubKey(fromBase64(pub_key.key))
    const sequenceNumber = parseInt(sequence)

    const msgValue: MsgWithdraw = msg.value

    const txBody: TxBody = TxBody.fromPartial({
      messages: [{ 
        typeUrl: CarbonTx.Types.MsgWithdraw,
        value: MsgWithdraw.encode(msgValue).finish()
      }],
      extensionOptions: [
        {
          typeUrl: "/ethermint.types.v1.ExtensionOptionsWeb3Tx",
          value: ExtensionOptionsWeb3Tx.encode(ExtensionOptionsWeb3Tx.fromPartial({
            typedDataChainId: 9790,
            feePayer: from,
            feePayerSig: fromHex(signature.slice(2)),
          })).finish()
        }
      ],
    })
    const feeAmount = [
      {
        amount: '0',
        denom: 'swth',
      },
    ] // list of coins with only 1 element
    const gasLimit = Int53.fromString(DEFAULT_FEE.gas).toNumber()
    
    // get TxRaw fromPartial
    const txRaw = TxRaw.fromPartial({
      bodyBytes: TxBody.encode(txBody).finish(),
      authInfoBytes: makeAuthInfoBytes(
        [{ pubkey, sequence: sequenceNumber }],
        feeAmount,
        gasLimit,
        undefined,
        from,
        SignMode.SIGN_MODE_LEGACY_AMINO_JSON
      ), // no feeGranter
      signatures: [new Uint8Array()],
    })

    // convert TxRaw to binary to base64
    const binary = TxRaw.encode(txRaw).finish()
    const payload = Buffer.from(binary).toString('base64')

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
}
