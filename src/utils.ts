import BigNumber from 'bignumber.js'
import {
  EIP712Tx,
  Fill,
  MarketParams,
  Order,
  PerpMarketParams,
  Position,
  SimpleMap,
  Trade,
  TypedDataField,
  UserFill,
} from './types'
import { AminoMsg } from '@cosmjs/amino/build'
import { parseChainId } from 'carbon-js-sdk/lib/util/ethermint'
import { TxTypes, EIP712Types } from 'carbon-js-sdk/lib/codec'
import capitalize from 'lodash.capitalize'
import {
  DEFAULT_CARBON_DOMAIN_FIELDS,
  DEFAULT_EIP712_TYPES,
} from 'carbon-js-sdk/lib/constant/eip712'
import { CarbonTx } from 'carbon-js-sdk'

export function sleep(interval: number = 1000) {
  return new Promise(resolve => {
    setTimeout(resolve, interval)
  })
}

export function toHumanPrice(
  price: string,
  params: MarketParams | PerpMarketParams
): number {
  return new BigNumber(price)
    .shiftedBy(params.basePrecision - params.quotePrecision)
    .toNumber()
}

export function toHumanQuantity(quantity: string, decimals: number): number {
  return new BigNumber(quantity).shiftedBy(-decimals).toNumber()
}

export function humanizeOrder(o: any, marketParams: MarketParams): Order {
  const order = {
    ...o,
    price: toHumanPrice(o.price, marketParams),
    quantity: toHumanQuantity(o.quantity, marketParams.basePrecision),
    available: toHumanQuantity(o.available, marketParams.basePrecision),
    filled: toHumanQuantity(o.filled, marketParams.basePrecision),
    stop_price: toHumanPrice(o.stop_price, marketParams),
    avg_filled_price: toHumanPrice(o.avg_filled_price, marketParams),
    allocated_margin_amount: toHumanQuantity(o.allocated_margin_amount, 18),
  }
  return snakeToCamel(order)
}
export function humanizePosition(p: any, marketParams: MarketParams): Position {
  const market = marketParams.displayName.split('_')[0]
  const position = {
    ...p,
    market,
    realized_pnl: toHumanQuantity(p.realized_pnl, 18),
    max_lots: toHumanQuantity(p.max_lots, marketParams.basePrecision),
    total_fee_amount: toHumanQuantity(p.total_fee_amount, 18),
    avg_allocated_margin: toHumanQuantity(p.avg_allocated_margin, 18),
    avg_entry_price: toHumanPrice(p.avg_entry_price, marketParams),
    avg_exit_price: toHumanPrice(p.avg_exit_price, marketParams),
    allocated_margin: toHumanQuantity(p.allocated_margin, 18),
    lots: toHumanQuantity(p.lots, marketParams.basePrecision),
  }
  return snakeToCamel(position)
}

export function humanizeFill(f: any, marketParams: MarketParams): Trade {
  // console.log(f, marketParams)
  const fill = {
    ...f,
    quantity: toHumanQuantity(f.quantity, marketParams.basePrecision),
    price: toHumanPrice(f.price, marketParams),
    fee_amount: toHumanQuantity(f.fee_amount, 18),
    // taker_fee_amount: toHumanQuantity(f.taker_fee_amount, 18),
    // taker_fee_kickback: toHumanQuantity(f.taker_fee_kickback, 18),
    // taker_fee_commission: toHumanQuantity(f.taker_fee_commission, 18),
    // maker_fee_amount: toHumanQuantity(f.maker_fee_amount, 18),
    // maker_fee_kickback: toHumanQuantity(f.maker_fee_kickback, 18),
    // maker_fee_commission: toHumanQuantity(f.maker_fee_commission, 18),
  }
  return snakeToCamel(fill)
}
export function humanizeUserFill(
  f: any,
  marketParams: MarketParams,
  address: string
): UserFill {
  const { id, market, quantity, price, block_height, block_created_at, taker_fee_denom } =
    f
  let side = f.taker_side
  let fee_amount = f.taker_fee_amount
  if (address === f.maker_address) {
    side = f.maker_side
    fee_amount = f.maker_fee_amount
  }
  const fill = {
    id,
    market,
    quantity: toHumanQuantity(quantity, marketParams.basePrecision),
    price: toHumanPrice(price, marketParams),
    side,
    address,
    fee_denom: taker_fee_denom,
    fee_amount: toHumanQuantity(fee_amount, 18),
    block_height: parseInt(block_height),
    block_created_at,
  }
  return snakeToCamel(fill)
}

export function sortDesc(lhs: any, rhs: any) {
  if (lhs > rhs) return -1
  if (rhs > rhs) return 1
  return 0
}
export function sortAsc(lhs: any, rhs: any) {
  if (lhs > rhs) return 1
  if (rhs > rhs) return -1
  return 0
}

export function snakeToCamel(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map(snakeToCamel)
  }

  return Object.keys(obj).reduce((acc, key) => {
    const camelKey = key.replace(/_(\w)/g, (_, letter) => letter.toUpperCase())
    acc[camelKey] = snakeToCamel(obj[key])
    return acc
  }, {})
}

export const AuthorizedSignlessMsgs = [
  // alliance
  TxTypes.MsgAllianceDelegate,
  TxTypes.MsgAllianceUndelegate,
  TxTypes.MsgAllianceRedelegate,
  TxTypes.MsgAllianceClaimDelegationRewards,
  TxTypes.MsgWithdrawDelegatorReward,

  // cdp
  TxTypes.MsgSupplyAsset,
  TxTypes.MsgWithdrawAsset,
  TxTypes.MsgLockCollateral,
  TxTypes.MsgUnlockCollateral,
  TxTypes.MsgBorrowAsset,
  TxTypes.MsgSupplyAssetAndLockCollateral,
  TxTypes.MsgUnlockCollateralAndWithdrawAsset,
  TxTypes.MsgLiquidateCollateral,
  TxTypes.MsgLiquidateCollateralWithCdpTokens,
  TxTypes.MsgLiquidateCollateralWithCollateral,
  TxTypes.MsgLiquidateCollateralWithStablecoin,
  TxTypes.MsgRepayAsset,
  TxTypes.MsgRepayAssetWithCdpTokens,
  TxTypes.MsgRepayAssetWithCollateral,
  TxTypes.MsgMintStablecoin,
  TxTypes.MsgReturnStablecoin,
  TxTypes.MsgClaimRewards,
  TxTypes.MsgSetAccountEMode,
  TxTypes.MsgRemoveAccountEMode,

  // coin
  TxTypes.MsgDepositToGroup,
  TxTypes.MsgWithdrawFromGroup,
  TxTypes.MsgCreateToken,

  // leverages
  TxTypes.MsgSetLeverage,

  // liquiditypool
  TxTypes.MsgCreatePool,
  TxTypes.MsgCreatePoolWithLiquidity,
  TxTypes.MsgAddLiquidity,
  TxTypes.MsgRemoveLiquidity,
  TxTypes.MsgStakePoolToken,
  TxTypes.MsgUnstakePoolToken,
  TxTypes.MsgClaimPoolRewards,

  // order
  TxTypes.MsgCreateOrder,
  TxTypes.MsgCancelOrder,
  TxTypes.MsgEditOrder,
  TxTypes.MsgCancelAll,

  // perpspool
  TxTypes.MsgDepositToPool,
  TxTypes.MsgWithdrawFromPool,

  // position
  TxTypes.MsgSetMargin,

  // profile
  TxTypes.MsgUpdateProfile,

  // staking
  TxTypes.MsgDelegate,
  TxTypes.MsgUndelegate,
  TxTypes.MsgBeginRedelegate,

  // subaccount
  TxTypes.MsgCreateSubAccount,
  TxTypes.MsgActivateSubAccount,
  TxTypes.MsgRemoveSubAccount,
]

function convertMsgs(msgs: readonly AminoMsg[]): any {
  const convertedMsgs: any = {}
  msgs.forEach((msg, index) => {
    convertedMsgs[`msg${index}`] = msg
  })
  return convertedMsgs
}

function compareValues(
  msg: any,
  key: string,
  eipTypes: SimpleMap<TypedDataField[]>
): boolean {
  let match = true
  for (let { name, type } of eipTypes[key]) {
    // eslint-disable-line
    if (Object.keys(msg).length > eipTypes[key].length) {
      return false
    }
    let value = msg[name]
    if (!isNonZeroField(value)) {
      return false
    }
    const typeIsArray = type.includes('[]')
    if (typeIsArray) {
      type = type.split('[]')[0]
      //Assumption: Take first value in array to determine which fields are populated
      value = value[0]
    }
    if (eipTypes[type]) {
      match = compareValues(value, type, eipTypes)
    }
  }
  return match
}
// Checks if there is a need to create new type for the same message type because of different populated fields
function matchingType(msg: AminoMsg, eipTypes: SimpleMap<TypedDataField[]>): string {
  const msgType = msg.type.split('/')[1]
  let match = false

  for (const key in eipTypes) {
    if (key.includes(msgType)) {
      match = compareValues(msg, key, eipTypes)
    }
    if (match) {
      return key
    }
  }
  return ''
}

function sortByNameDescending(
  types: SimpleMap<TypedDataField[]>
): SimpleMap<TypedDataField[]> {
  Object.entries(types).forEach(([key, _]) => {
    // eslint-disable-line
    types[key].sort((a, b) => b.name.localeCompare(a.name))
  })
  return types
}
function getLatestMsgTypeIndex(
  typeName: string,
  types: SimpleMap<TypedDataField[]>
): number {
  let index = 0
  Object.entries(types).forEach(([key, _]) => {
    // eslint-disable-line

    if (key.includes(typeName)) {
      index++
    }
  })

  return index
}
function getTypeName(
  name: string,
  index: number,
  objectName?: string,
  nestedType: boolean = false,
  isArray: boolean = false
) {
  if (nestedType) {
    return `Type${objectName ? objectName : ''}${name
      .split('_')
      .map(subName => capitalize(subName))
      .join('')}${index}${isArray ? '[]' : ''}`
  }
  return name
}

function isGoogleProtobufAnyPackage(packageName: string, type: string): boolean {
  return packageName === '/google.protobuf' && type == 'Any'
}

function isNonZeroField(fieldValue: any): boolean {
  // zero fields are considered falsey,except if it is string "0"
  if (fieldValue == '0' && typeof fieldValue !== 'string') {
    return false
  }
  // empty arrays are considered truthy
  if (Array.isArray(fieldValue)) {
    return true
  }
  // empty objects are considered truthy
  if (
    fieldValue &&
    typeof fieldValue === 'object' &&
    Object.keys(fieldValue).length === 0
  ) {
    return true
  }
  return fieldValue
}
function getMsgValueType(
  msgTypeUrl: string,
  msgValue: any,
  msgTypeName: string,
  msgTypeIndex: number,
  types: SimpleMap<TypedDataField[]>,
  objectName?: string,
  nestedType: boolean = false,
  msgTypeDefinitions: SimpleMap<TypedDataField[]> = {}
): SimpleMap<TypedDataField[]> {
  const packageName = msgTypeUrl.split('.').slice(0, -1).join('.')
  const msgFieldType = msgTypeUrl.split('.').pop()!
  const typeName = getTypeName(msgTypeName, msgTypeIndex, objectName, nestedType, false)
  const fieldsDefinition = EIP712Types[packageName][msgFieldType]
  if (isNonZeroField(msgValue)) {
    if (!msgTypeDefinitions[typeName]) {
      msgTypeDefinitions[typeName] = []
    }
    fieldsDefinition.forEach(({ packageName, name, type }: any) => {
      const fieldValue =
        Array.isArray(msgValue) && msgValue.length > 0
          ? msgValue[0][name]
          : msgValue[name]
      //Assumption: Take first value in array to determine which fields are populated
      if (isNonZeroField(fieldValue)) {
        if (Array.isArray(fieldValue) && fieldValue.length === 0) {
          msgTypeDefinitions[typeName] = [
            ...msgTypeDefinitions[typeName],
            { name, type: 'string[]' },
          ]
          return
        }
        //For nested structs
        if (packageName) {
          const isArray = type.includes('[]') ? true : false
          // TypeValue0 --> Value
          const objectName = typeName.split('Type')[1].split(/\d+/)[0]
          const nestedTypeName = `Type${objectName ? objectName : ''}${name
            .split('_')
            .map((subName: string) => capitalize(subName))
            .join('')}`
          const nestedMsgTypeIndex = getLatestMsgTypeIndex(nestedTypeName, types)
          const nestedType = getTypeName(
            name,
            nestedMsgTypeIndex,
            objectName,
            true,
            isArray
          )
          msgTypeDefinitions[typeName] = [
            ...msgTypeDefinitions[typeName],
            { name, type: nestedType },
          ]
          //Special logic if nested struct is google protobuf's Any type
          if (isGoogleProtobufAnyPackage(packageName, type)) {
            const nestedAnyTypeName = isArray
              ? nestedType.split('[]')[0].split(/\d+/)[0]
              : nestedType.split(/\d+/)[0]
            const nestedMsgTypeIndex = getLatestMsgTypeIndex(
              `${nestedAnyTypeName}Value`,
              types
            )
            const nestedAnyValueType = `${nestedAnyTypeName}Value${nestedMsgTypeIndex}`
            msgTypeDefinitions[`${nestedAnyTypeName}${nestedMsgTypeIndex}`] = [
              { name: 'type', type: 'string' },
              { name: 'value', type: nestedAnyValueType },
            ]
            const anyObjectTypeNameSplit = nestedAnyTypeName
              .split('Type')[1]
              .split(/\d+/)[0]
            const messageTypeUrl = '/google.protobuf.Any'
            getMsgValueType(
              messageTypeUrl,
              fieldValue.value,
              'value',
              nestedMsgTypeIndex,
              types,
              anyObjectTypeNameSplit,
              true,
              msgTypeDefinitions
            )
          } else {
            const typeStructName = type.includes('[]')
              ? type.split('[]')[0].split(/\d+/)[0]
              : type.split(/\d+/)[0]
            const messageTypeUrl = `${packageName}.${typeStructName}`
            getMsgValueType(
              messageTypeUrl,
              fieldValue,
              name,
              nestedMsgTypeIndex,
              types,
              objectName,
              true,
              msgTypeDefinitions
            )
          }
        } else {
          msgTypeDefinitions[typeName] = [
            ...msgTypeDefinitions[typeName],
            { name, type: getGjsonPrimitiveType(fieldValue) },
          ]
        }
      }
    })
  }
  return msgTypeDefinitions
}
function getGjsonPrimitiveType(value: any) {
  if (typeof value === 'number') {
    return 'int64'
  }
  if (typeof value === 'boolean') {
    return 'bool'
  }
  if (
    Array.isArray(value) &&
    value.length &&
    value.every(item => typeof item === 'string')
  ) {
    return 'string[]'
  }
  return 'string'
}
function getTypes(
  msgs: readonly AminoMsg[],
  typeUrls: string[]
): SimpleMap<TypedDataField[]> {
  let types: SimpleMap<TypedDataField[]> = { ...DEFAULT_EIP712_TYPES }
  const includedTypes: string[] = []
  let valueIndex = 0
  msgs.forEach((msg: AminoMsg, index: number) => {
    // @dev typeUrl IS HARDCODED for now as I am unable to fix AminoTypesMap
    const typeUrl = typeUrls[index]

    const msgType = msg.type.split('/')[1]
    const msgTypeIndex = getLatestMsgTypeIndex(`Type${msgType}`, types)
    //cosmos-sdk/MsgSend => TypeMsgSend1
    const typeKey = `Type${msgType}${msgTypeIndex}`
    if (!includedTypes.includes(msg.type)) {
      types['Tx'] = [...types['Tx'], { name: `msg${index}`, type: typeKey }]
      types[typeKey] = [
        { name: 'value', type: `TypeValue${valueIndex}` },
        { name: 'type', type: 'string' },
      ]
      //cosmos-sdk/MsgSend => Msg_Send
      types = {
        ...types,
        ...sortByNameDescending(
          getMsgValueType(typeUrl, msg.value, `TypeValue${valueIndex}`, valueIndex, types)
        ),
      }
      includedTypes.push(msg.type)
      valueIndex++
      return
    }
    const typeFound = matchingType(msg, types)
    if (typeFound) {
      types['Tx'] = [...types['Tx'], { name: `msg${index}`, type: typeFound }]
      return
    }
    //same type, but different fields populated, so new type defnition is required
    types['Tx'] = [...types['Tx'], { name: `msg${index}`, type: typeKey }]
    types[typeKey] = [
      { name: 'value', type: `TypeValue${valueIndex}` },
      { name: 'type', type: 'string' },
    ]
    types = {
      ...types,
      ...sortByNameDescending(
        getMsgValueType(typeUrl, msg.value, `TypeValue${valueIndex}`, valueIndex, types)
      ),
    }
    valueIndex++
  })
  return types
}

export function constructEIP712Tx(
  doc: CarbonTx.StdSignDoc,
  typeUrls: string[]
): EIP712Tx {
  const { account_number, chain_id, fee, memo, sequence } = doc
  const eip712Tx = {
    types: getTypes(doc.msgs, typeUrls),
    primaryType: 'Tx',
    domain: { ...DEFAULT_CARBON_DOMAIN_FIELDS, chainId: parseChainId(doc.chain_id) },
    message: { account_number, chain_id, fee, memo, sequence, ...convertMsgs(doc.msgs) },
  }

  return eip712Tx
}

export function toCamelCase(str: string) {
  return str.replace(/([-_][a-z])/gi, match => {
    return match.toUpperCase().replace('-', '').replace('_', '')
  })
}

export function camelCaseKeys(obj: string) {
  if (Array.isArray(obj)) {
    return obj.map(v => camelCaseKeys(v))
  } else if (obj !== null && obj.constructor === Object) {
    return Object.keys(obj).reduce((result, key) => {
      const camelCaseKey = toCamelCase(key)
      result[camelCaseKey] = camelCaseKeys(obj[key])
      return result
    }, {})
  }
  return obj
}

// Utility function to convert a string to snake_case
export function toSnakeCase(str) {
  return str.replace(/([A-Z])/g, '_$1').toLowerCase()
}

// Function to convert keys of an object to snake_case
export function convertKeysToSnakeCase(obj) {
  if (Array.isArray(obj)) {
    return obj.map(convertKeysToSnakeCase)
  } else if (obj !== null && obj.constructor === Object) {
    return Object.keys(obj).reduce((acc, key) => {
      const snakeKey = toSnakeCase(key)
      acc[snakeKey] = convertKeysToSnakeCase(obj[key])
      return acc
    }, {})
  }
  return obj
}
