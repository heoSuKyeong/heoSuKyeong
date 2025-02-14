import {
	IAttribute,
	IDataModelContainer,
	IDataModelDescriptor,
	ISelector,
} from 'ecount.fundamental.datamodel/definition';
import { EN_ACTION_MODE, EN_ATTR_TYPE, EN_INPUT_MENU_TYPE, EN_MENU_TYPE } from 'ecount.fundamental.define/enum';
import { Exception } from 'ecount.fundamental.define/exception';
import { $data_model_key_current } from 'ecount.fundamental.define/type';
import { EN_VALUE_RESOLVER_ATTR_ID, IConfigurationContext } from 'ecount.infra.base/abstraction';
import { IArrayDataModelMapper } from 'ecount.infra.base/setup';
import { IBizzStackInfo, IExecutionContext } from 'ecount.infra.bridge/base';
import { IDataModelValidationDetail, IDataModelValidationException } from 'ecount.infra.bridge/exception';
import { program_impl } from 'ecount.infra.common/decorator';
import { ExceptionBuilder } from 'ecount.infra.common/exception';
import { BizzProgram, ProgramBuilder } from 'ecount.infra.common/program';
import { ISlipDataModel, IValidateSlipDataModelException } from 'ecount.usecase.base/@abstraction';
import {
	ExecuteSetupMainRequestDto,
	ExecuteSetupMainResultDto,
	IBaseSlipDeriveDto,
	IDataModelInitializerProgram,
	IDataModelModifierProgram,
	IDataModelValidatorProgram,
	IDataModelValidatorProgramDto,
	IDataModelValidatorProgramResult,
	IDeriveFeature,
	IExecuteSetupMainProgram,
	IInitializeSlipDataModelProgram,
	IInitializeSlipDataModelProgramDto,
	IInitializeSlipDataModelProgramResult,
	IPostExecuterProgram,
	IPostExecuterProgramDto,
	IPostExecuterProgramResult,
	IPreExecuterProgram,
	IPreExecuterProgramDto,
	IPreExecuterProgramResult,
	IPreResolveDataModelProgram,
	ISelectValueResolverAttrsProgram,
	ISelectValueResolverAttrsProgramDto,
	ISlipDataModelContainer,
	IValidateSlipDataModelProgram,
	IValidateSlipDataModelProgramDto,
	IValidateSlipDataModelProgramResult,
	IValueResolverConfigureFeature,
	SlipBizzInfo,
	IBizzValueResolverFeature,
	ISubArrayFeature,
	IDeriveFeatureV2,
	IResolveDataModelProgram,
	IResolveDataModelProgramDto,
	IResolveDataModelProgramResult,
} from 'ecount.usecase.common/@abstraction';
import { BizzValueResolverFeature, SlipDataModelContainer } from 'ecount.usecase.common/@implement';
import {
	AttrSetDto,
	IGetV3FormTypeMapperProgram,
	ITemplateUtilFeature,
	IV3FormAttributeFeature,
	IV3FormAttributeSelectorFactory,
	IV3TemplateUtilFactory,
	V3FormAttrRequestDto,
	V3FormTypeMapperRequestDto,
} from 'ecount.usecase.setup/@abstraction';
import { InputFormAttrV3ToV5ConvertFeature } from 'ecount.usecase.setup/@implement';

/**
 * ExcuteSetup MainProgram
 */
@program_impl(IExecuteSetupMainProgram)
export class ExecuteSetupMainProgram
	extends BizzProgram<ExecuteSetupMainRequestDto, ExecuteSetupMainResultDto, SlipBizzInfo, IExecutionContext>
	implements IExecuteSetupMainProgram
{
	smc: ISlipDataModelContainer;
	dmc: IDataModelContainer[];
	result: ExecuteSetupMainResultDto;
	master_data_model_id: string;
	detail_data_model_id: string;
	v3_form_type: string;

	constructor(execution_context: IExecutionContext) {
		super(execution_context);
	}
	protected getBizzData(request: ExecuteSetupMainRequestDto): IBizzStackInfo<SlipBizzInfo> {
		const bizz_info: IBizzStackInfo<SlipBizzInfo> = {
			type: 'slip',
			data: {
				bizz_sid: request.slip_data_model.bizz_sid,
				data_dt: request.slip_data_model.data_dt ?? '',
				data_no: request.slip_data_model.data_no ?? 0,
			},
		};
		return bizz_info;
	}

	onConfigure(configuration_context: IConfigurationContext): void {
		configuration_context.setFeature<ITemplateUtilFeature>(
			ITemplateUtilFeature,
			this.execution_context
				.getFeature<IV3TemplateUtilFactory>(IV3TemplateUtilFactory)
				.createInstance(this.execution_context)
		);

		configuration_context.setFeature<IV3FormAttributeFeature>(
			IV3FormAttributeFeature,
			new InputFormAttrV3ToV5ConvertFeature(this.execution_context)
		);

		configuration_context.setFeature<IBizzValueResolverFeature>(
			IBizzValueResolverFeature,
			new BizzValueResolverFeature(this.execution_context)
		);
	}

	// checkJSJ transaction
	@_transaction(TransactionOption.Required)
	onExecute(request: ExecuteSetupMainRequestDto): ExecuteSetupMainResultDto {
		this._onInit(request);
		this._runExecuteSetupMainProgram(request);
		// checkJSJ 결과데이터 반환 고민
		return this.result as ExecuteSetupMainResultDto;
	}

	@_transaction(TransactionOption.Required)
	private _runExecuteSetupMainProgram(request: ExecuteSetupMainRequestDto): void {
		//------------------------------------------------------------------------
		// [#0] create program
		//------------------------------------------------------------------------
		const {
			slip_initializer_program,
			slip_validator_program,
			data_model_initializer_program,
			data_model_modifier_program,
			data_model_validator_program,
			data_model_resolver_program,
			post_executer_resolver_program,
			pre_executer_resolver_program,
			pre_data_model_resolver_program,
		} = this._createProgram(this.execution_context);

		const { action_mode, menu_type, data_dt, data_no, data_sid } = request.slip_data_model;
		const slip = {
			action_mode,
			menu_type,
			data_dt,
			data_no,
			data_sid,
			bizz_sid: this.smc.getSlipDefinition().bizz_sid,
			menu_sid: this.smc.getSlipDefinition().menu_sid,
			data_model: this.smc.getSlipDataModel(),
		} as ISlipDataModel;

		const get_resolver_attr_program = ProgramBuilder.create<AttrSetDto, IAttribute[]>(
			ISelectValueResolverAttrsProgram,
			this.execution_context
		);

		const value_resolver_attrs_by_refer_type = get_resolver_attr_program.execute({
			bizz_sid: 'common_resolve_value',
			attr_id: EN_VALUE_RESOLVER_ATTR_ID.modifier_resolve_value,
		} as ISelectValueResolverAttrsProgramDto);

		const factory = this.execution_context.getFeature<IV3FormAttributeSelectorFactory>(
			IV3FormAttributeSelectorFactory
		);
		const v3_column_map_feature = this.execution_context.getFeature<ITemplateUtilFeature>(ITemplateUtilFeature);
		const column_map = v3_column_map_feature.getPropsMapByBizzId(
			_.vSafe(this.execution_context.action.menu_type),
			false
		);

		const selector_map = new Map<string, ISelector>();
		const descriptor_map = new Map<string, IDataModelDescriptor>();
		const data_models = this.smc.getSlipDataModel();
		const smc_definition = this.smc.getDataModelDefinitions();
		const target_action_mode = new Set<EN_ACTION_MODE>([EN_ACTION_MODE.Create, EN_ACTION_MODE.Modify]);
		const target_data_model_id = new Set<string>([this.master_data_model_id, this.detail_data_model_id]);
		const sub_array_feature = this.execution_context.getFeature<ISubArrayFeature>(ISubArrayFeature);
		const sub_array_db_info_list = sub_array_feature.getAffiliationList();

		for (const dmc of this.smc.createDataModelContainer((def) => {
			if (target_data_model_id.has(_.vSafe(def?.data_model_id))) {
				// selector
				const selector = factory.create(
					this.execution_context,
					{
						bizz_sid: this.execution_context.action.bizz_sid,
						menu_sid: this.execution_context.action.menu_sid,
						menu_type: _.vSafe(menu_type, this.execution_context.action.menu_type),
						form_type: this.v3_form_type,
						form_seq: _.vSafe(request.current_template, 1),
						column_map,
						get_all_tables: true,
						data_model_id: def?.data_model_id,
						is_from_za_only: request.is_from_za_only ?? _.vIsEmpty(request.current_template) ? true : false,
					} as V3FormAttrRequestDto,
					def?.attributes
				);

				selector_map.set(_.vSafe(def?.data_model_id), selector);

				// descriptor

				const descriptor = this.execution_context.bizz_mgr.getDataModelDescriptor(
					this.execution_context,
					_.vSafe(def?.data_model_id)
				);

				descriptor_map.set(_.vSafe(def?.data_model_id), _.vSafe(descriptor));

				return {
					selector,
					//enable_auto_static_sync: true,
				};
			}
		}, sub_array_db_info_list)) {
			this.dmc.push(dmc);

			value_resolver_attrs_by_refer_type.push(
				...get_resolver_attr_program.execute({
					data_model_id: dmc.data_model_id,
					attr_id: EN_VALUE_RESOLVER_ATTR_ID.modifier_resolve_value,
				} as ISelectValueResolverAttrsProgramDto)
			);
		}

		// checkVRTFT
		this._executeValueChange1({
			value_resolver_attrs_by_refer_type,
			selector_map,
			descriptor_map,
			target_action_mode,
			data_models,
			option: {
				form_type: this.v3_form_type,
				form_seq: _.vToString(request.current_template),
			},
		});

		//------------------------------------------------------------------------
		// [#1] pre_executer resolver
		//------------------------------------------------------------------------
		pre_executer_resolver_program.execute({
			definitions: smc_definition,
			slip_attributes: this.smc.getAttrsByAttrType(EN_ATTR_TYPE.PreExecuter),
			slip_data_model: slip,
		});

		//------------------------------------------------------------------------
		// [#2] slip initializer
		//------------------------------------------------------------------------
		// dmc 생성하지 않고, 데이터 모델 원본을 직접 변경한다.
		slip_initializer_program.execute({
			definitions: smc_definition,
			slip_attributes: this.smc.getAttrsByAttrType(EN_ATTR_TYPE.Initializer),
			slip_data_model: slip,
		});

		// checkVRTFT
		this._executeValueChange2({
			value_resolver_attrs_by_refer_type,
			selector_map,
			descriptor_map,
			target_action_mode,
			target_data_model_id,
			data_models,
			option: {
				form_type: this.v3_form_type,
				form_seq: _.vToString(request.current_template),
			},
		});

		const validator_error_list: IDataModelValidationDetail[] = [];
		/* 기본값 세팅된 slip_data_model을 다시 dmc data_model에 매핑 */
		//=============================================================================
		/* ----------- Dmc별 prop initializer, modifier, validator 실행 ----------- */
		for (const dmc of this.dmc) {
			//------------------------------------------------------------------------
			// [#3] data_model initializer
			//------------------------------------------------------------------------
			data_model_initializer_program.execute(dmc);

			//------------------------------------------------------------------------
			// [#4] data_model modifier
			//------------------------------------------------------------------------
			data_model_modifier_program.execute(dmc);

			//------------------------------------------------------------------------
			// [#5] data_model validator
			//------------------------------------------------------------------------
			const validator_result = data_model_validator_program.execute({
				data_model_container: dmc,
				menu_type,
			});

			if (!_.vIsEmpty(validator_result.exception)) {
				validator_error_list.push(...validator_result.exception.details);
			}
		}

		if (!_.vIsEmpty(validator_error_list)) {
			Exception.throw(
				ExceptionBuilder.create<IDataModelValidationException>(IDataModelValidationException, {
					data_model_id: this.master_data_model_id,
					details: validator_error_list,
				})
			);
		}

		//------------------------------------------------------------------------
		// [#6] slip valiator
		//------------------------------------------------------------------------
		// 전표 기준 비즈니스 로직 처리(허용창고, 편집제한일자등..)
		const slip_validator_result = slip_validator_program.execute({
			dmc: this.dmc,
			slip_data_model: slip,
			slip_attributes: this.smc.getAttrsByAttrType(EN_ATTR_TYPE.Validator),
			additional_info: request.additional_info,
		});
		// checkJSJ 반한결과 확인후 로직 수정
		if (!_.vIsEmpty(slip_validator_result.exceptions)) {
			Exception.throw(
				ExceptionBuilder.create<IValidateSlipDataModelException>(IValidateSlipDataModelException, {
					exceptions: slip_validator_result.exceptions,
				})
			);
		}

		//------------------------------------------------------------------------
		// [#7] data_model resolver
		//------------------------------------------------------------------------
		this.smc = pre_data_model_resolver_program.execute(this.smc);
		this.dmc = this.smc.getDataModelContainers();

		//------------------------------------------------------------------------
		// [#8] data_model resolver
		//------------------------------------------------------------------------
		// 상단 / 하단 / 부속 data_model 단위로 처리
		// checkJSJ getDataModelContainser 소스정리
		const slip_created_result: { [key: string]: IResolveDataModelProgramResult } = {};
		const return_data_model: IArrayDataModelMapper = {};
		_.vForEach(this.dmc, (dmc) => {
			const data_model = dmc.getDataModel();
			// if (_.vIsEmpty(data_model)) return;

			slip_created_result[dmc.data_model_id] = data_model_resolver_program.execute({
				action_mode: slip.action_mode,
				dmc,
				data_sid: slip.data_sid,
			});

			return_data_model[dmc.data_model_id] = data_model as [{ [prop_id: string]: any }];
		});

		this.result.slip_created_result = slip_created_result;
		this.result.data_model = return_data_model;

		//------------------------------------------------------------------------
		// [#9] derived slip
		//------------------------------------------------------------------------

		// 수정, 진행상태 변경 시 파생 관련  에러
		// ====================================================
		let derive_feature = this.execution_context.getFeature<IDeriveFeature>(IDeriveFeature);

		// fdsf
		// 파생 V2 적용할 bizz_sid
		const bizz_sid_for_derive_v2 = [
			'B_000000E201767', // 시간관리
			'B_000000E040201', // 견적
			'B_000000E040314', // 발주요청
		];

		if (bizz_sid_for_derive_v2.includes(this.execution_context.action.bizz_sid)) {
			derive_feature = this.execution_context.getFeature<IDeriveFeatureV2>(IDeriveFeatureV2);
		}

		// checkJSJ action_mode를 판단해서 처리가능할지 확인
		const derive_feature_result = this._executeDerive(derive_feature, request.derive_info, action_mode);

		if (!_.vIsEmpty(derive_feature_result)) {
			_.vExtend(this.result.slip_created_result, derive_feature_result.data);
			// checkJSJ
			// 파생 정상처리 안된경우 ex 발생
			// 파생 관련 정보가 error에 담기지 않고, bool값만 처리됨?
		}

		// =====================================================

		//------------------------------------------------------------------------
		// [#10] 개별 전표 저장후
		//------------------------------------------------------------------------
		post_executer_resolver_program.execute({
			definitions: smc_definition,
			slip_attributes: this.smc.getAttrsByAttrType(EN_ATTR_TYPE.PostExecuter),
			slip_data_model: slip,
			dmcs: this.dmc,
		});
		// checkJSJ try-catch문 꼭 필요한지. core에서처리해주는 부분 없는지 확인.
		// 반환할 값들을 try-catch 바깥 스코프로 옮겨줄지 / try-catch 내에서 return 할지
		// ExecuteSetupMainResultDto 내부 타입도 확인 필요
	}
	/** init func */
	private _onInit(request: ExecuteSetupMainRequestDto) {
		if (_.vIsEmpty(request)) {
			throw new Exception('Exception Empty Request Info ');
		}

		if (_.vIsEmpty(request?.slip_data_model) || _.vIsEmpty(request?.derive_info)) {
			throw new Exception('Exception Empty Request Detail Info');
		}

		// smc가 빈 객체여도 값이 없다고 판별하지 않음 -> 에러 발생
		//=============================================================================
		this.smc = _.vSafe(
			request.derive_info.smc,
			new SlipDataModelContainer(this.execution_context, request.slip_data_model)
		);

		request.derive_info.additional_info = request.additional_info; // 파생 to_bizz에 additional_info를 전달하기 위해 할당(유효성체크 결과 등 포함)

		this.dmc = [];
		//=============================================================================

		if (_.vIsEmpty(this.smc)) {
			throw new Exception('Exception Empty smc Info');
		}

		this.master_data_model_id = this.execution_context.bizz_mgr.getBizzDataModelId(
			this.execution_context,
			this.execution_context.action.bizz_sid,
			EN_INPUT_MENU_TYPE.Master
		);

		this.detail_data_model_id = this.execution_context.bizz_mgr.getBizzDataModelId(
			this.execution_context,
			this.execution_context.action.bizz_sid,
			EN_INPUT_MENU_TYPE.Detail
		);

		// v3
		const form_type_program = ProgramBuilder.create<V3FormTypeMapperRequestDto, string>(
			IGetV3FormTypeMapperProgram,
			this.execution_context
		);
		this.v3_form_type = form_type_program.execute({
			bizz_sid: this.execution_context.action.bizz_sid,
			menu_type: this.execution_context.action.menu_type ?? EN_MENU_TYPE.Input,
		});
		this.result = {
			error: {},
		} as ExecuteSetupMainResultDto;
	}

	// checkJSJ 관련 로직 파생 기능에서 처리될 수 있을지 확인
	private _executeDerive(feature: IDeriveFeature, request: IBaseSlipDeriveDto, action_mode: EN_ACTION_MODE) {
		if (action_mode == EN_ACTION_MODE.Create) {
			return feature.save(request);
		}

		if (action_mode == EN_ACTION_MODE.Modify) {
			return feature.update(request);
		}

		return feature.change(request);
	}

	/**
	 *  Init - Create program
	 */
	private _createProgram(context: IExecutionContext) {
		return {
			slip_initializer_program: ProgramBuilder.create<
				IInitializeSlipDataModelProgramDto,
				IInitializeSlipDataModelProgramResult
			>(IInitializeSlipDataModelProgram, context),
			slip_validator_program: ProgramBuilder.create<
				IValidateSlipDataModelProgramDto,
				IValidateSlipDataModelProgramResult
			>(IValidateSlipDataModelProgram, context),
			data_model_validator_program: ProgramBuilder.create<
				IDataModelValidatorProgramDto,
				IDataModelValidatorProgramResult
			>(IDataModelValidatorProgram, context),
			data_model_modifier_program: ProgramBuilder.create<IDataModelContainer, IDataModelContainer>(
				IDataModelModifierProgram,
				context
			),
			data_model_initializer_program: ProgramBuilder.create<IDataModelContainer, IDataModelContainer>(
				IDataModelInitializerProgram,
				context
			),
			data_model_resolver_program: ProgramBuilder.create<
				IResolveDataModelProgramDto,
				IResolveDataModelProgramResult
			>(IResolveDataModelProgram, context),
			pre_executer_resolver_program: ProgramBuilder.create<IPreExecuterProgramDto, IPreExecuterProgramResult>(
				IPreExecuterProgram,
				context
			),
			post_executer_resolver_program: ProgramBuilder.create<IPostExecuterProgramDto, IPostExecuterProgramResult>(
				IPostExecuterProgram,
				context
			),
			pre_data_model_resolver_program: ProgramBuilder.create<ISlipDataModelContainer, ISlipDataModelContainer>(
				IPreResolveDataModelProgram,
				context
			),
		};
	}

	private _executeValueChange1(datas: {
		value_resolver_attrs_by_refer_type: IAttribute<any>[];
		selector_map: Map<string, ISelector>;
		descriptor_map: Map<string, IDataModelDescriptor>;
		target_action_mode: Set<EN_ACTION_MODE>;
		data_models: IArrayDataModelMapper | undefined;
		option?: {
			form_type?: string;
			form_seq?: string;
		};
	}) {
		const { value_resolver_attrs_by_refer_type, selector_map, descriptor_map, target_action_mode, data_models } =
			datas;
		const flowv2_configure_feature =
			this.execution_context.getFeature<IValueResolverConfigureFeature>(IValueResolverConfigureFeature);

		const descriptor = descriptor_map.get(this.master_data_model_id);
		const data_dt_prop_id = descriptor?.getPropIdByReferType('data_dt');

		for (const [data_model_id, data_model] of _.vEntries(data_models)) {
			// master인 경우에만 수행
			if (
				target_action_mode.has(_.vSafe(this.execution_context.action.action_mode)) &&
				_.vIsEquals(data_model_id, this.master_data_model_id)
			) {
				const selector = _.vSafe(selector_map.get(data_model_id));
				const descriptor = _.vSafe(descriptor_map.get(data_model_id));

				let is_data_dt = false;

				flowv2_configure_feature.executeValueResolver({
					data_model_id: data_model_id,
					data_models: data_model,
					descriptor: descriptor as IDataModelDescriptor,
					selector: selector,
					resolve_attr_id: EN_VALUE_RESOLVER_ATTR_ID.modifier_resolve_value,
					attrs_by_refer: value_resolver_attrs_by_refer_type,
					option: {
						onDataModelPropId: (
							target_data_model_id,
							target_attr,
							target_prop_definition,
							target_data_model,
							data_model_id,
							data_model,
							index
						) => {
							if (_.vIsEquals(target_prop_definition.prop_id, data_dt_prop_id)) {
								is_data_dt = true;
								return target_attr;
							}

							if (is_data_dt == true) {
								return;
							} else {
								return target_attr;
							}
						},
						form_type: datas.option?.form_type,
						form_seq: datas.option?.form_seq,
					},
				});
			}
		}
	}

	private _executeValueChange2(datas: {
		value_resolver_attrs_by_refer_type: IAttribute<any>[];
		selector_map: Map<string, ISelector>;
		descriptor_map: Map<string, IDataModelDescriptor>;
		target_action_mode: Set<EN_ACTION_MODE>;
		target_data_model_id: Set<string>;
		data_models: IArrayDataModelMapper | undefined;
		option?: {
			form_type?: string;
			form_seq?: string;
		};
	}) {
		const {
			value_resolver_attrs_by_refer_type,
			selector_map,
			descriptor_map,
			target_action_mode,
			target_data_model_id,
			data_models,
		} = datas;
		const flowv2_configure_feature =
			this.execution_context.getFeature<IValueResolverConfigureFeature>(IValueResolverConfigureFeature);

		const descriptor = _.vSafe(descriptor_map.get(this.master_data_model_id));
		const data_dt_prop_id = descriptor?.getPropIdByReferType('data_dt');

		for (const [data_model_id, data_model] of _.vEntries(data_models)) {
			if (
				target_action_mode.has(_.vSafe(this.execution_context.action.action_mode)) &&
				target_data_model_id.has(data_model_id)
			) {
				// 상단 돌고 하단 돌 때
				// 임시 코딩 한번에 돌 때 삭제될 소스

				if (data_model_id === this.detail_data_model_id) {
					this.execution_context.bizz_mgr.registerObject(
						this.execution_context,
						{ data_model_id: this.master_data_model_id, key: $data_model_key_current },
						data_models?.[this.master_data_model_id][0] ?? []
					);
				}
				const selector = _.vSafe(selector_map.get(data_model_id));
				const descriptor = _.vSafe(descriptor_map.get(data_model_id));

				flowv2_configure_feature.executeValueResolver({
					data_model_id: data_model_id,
					data_models: data_model,
					descriptor: descriptor as IDataModelDescriptor,
					selector: selector,
					resolve_attr_id: EN_VALUE_RESOLVER_ATTR_ID.modifier_resolve_value,
					attrs_by_refer: value_resolver_attrs_by_refer_type,
					option: {
						onDataModelPropId: (
							target_data_model_id,
							target_attr,
							target_prop_definition,
							target_data_model,
							data_model_id,
							data_model,
							index
						) => {
							if (
								_.vIsEquals(target_prop_definition.prop_id, descriptor?.getPropIdByReferType('data_dt'))
							) {
								return;
							} else {
								return target_attr;
							}
						},
						form_type: datas.option?.form_type,
						form_seq: datas.option?.form_seq,
					},
				});
			}
		}
	}
}
