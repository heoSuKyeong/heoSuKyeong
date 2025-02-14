import {
	DataModelContainer,
	EN_PROP_GROUP_SYNCTARGET_TYPE,
	EN_PROP_GROUP_TYPE,
	group_type_sync_data,
} from 'ecount.fundamental.datamodel/definition';
import {
	EN_ACTION_MODE,
	EN_ATTR_TYPE,
	EN_AUTHORITY_TYPE,
	EN_DATA_MODEL_ID,
	EN_INPUT_MENU_TYPE,
	EN_MENU_TYPE,
} from 'ecount.fundamental.define/enum';
import { Exception, IException } from 'ecount.fundamental.define/exception';
import { ActionDataBase, IMenuDefinition, ProgramIdentifier } from 'ecount.infra.base/abstraction';
import { HttpStatusCodes, IExecutionContext } from 'ecount.infra.bridge/base';
import { IDMManager, IDataModelContainer } from 'ecount.infra.bridge/data_model';
import { IHttpResult } from 'ecount.infra.bridge/dto';
import {
	ICommonException,
	IDataModelValidationDetail,
	IDataModelValidationException,
	IGeneralException,
} from 'ecount.infra.bridge/exception';
import { attribute, manager, system } from 'ecount.infra.bridge/feature';
import { IViewModelStateContainer } from 'ecount.infra.bridge/view_model';
import { program_impl } from 'ecount.infra.common/decorator';
import { ExceptionBuilder } from 'ecount.infra.common/exception';
import { BaseProgram, ProgramBuilder } from 'ecount.infra.common/program';
import { ICreateAndModifyAccountSaveButtonTypeRequestDto } from 'ecount.usecase.account/@abstraction';
import {
	CommonRequestDto,
	IDataModelValidatorRequestDto,
	IDataModelValidatorResultDto,
	ISlipDataModel,
	IValidateSlipDataModelException,
	menu_attrs,
} from 'ecount.usecase.base/@abstraction';
import {
	ApiResolverProgramRequestDto,
	ApiResolverProgramResultDto,
	BulkCheckAuthorityRequestDto,
	BulkCheckAuthorityResultDto,
	IActionRequestDto,
	IApiResolverProgram,
	IBulkCheckAuthorityAction,
	IDataModelModifierProgram,
	IDataModelValidatorProgram,
	IExResolver,
	IExecuteSetupMainProgram,
	IExecuteSetupMainProgramRequest,
	IExecuteSetupMainProgramResult,
	IPreExecuterProgram,
	IPreExecuterProgramDto,
	IPreExecuterProgramResult,
	ISetMenuAttrProgram,
	ISlipValidatorResolverProgramRequestDto,
	ISlipValidatorResolverReturnProgram,
	ISlipValidatorResolverReturnProgramRequestDto,
} from 'ecount.usecase.common/@abstraction';

/**
 * UI ExcuteSetup MainProgram
 */
@program_impl(IExecuteSetupMainProgram)
export class ExecuteSetupMainProgram
	extends BaseProgram<IExecuteSetupMainProgramRequest, IExecuteSetupMainProgramResult>
	implements IExecuteSetupMainProgram
{
	menu_definition: IMenuDefinition;
	api_request: ActionDataBase<CommonRequestDto>;
	master_data_model_id: string;
	result: IExecuteSetupMainProgramResult;
	original_data_model: { [key: string]: any[] };
	check_valid_row: { [key: string]: { [key: string]: boolean } };

	constructor(execution_context: IExecutionContext) {
		super(execution_context);
	}

	protected async onExecuteAsync(dto: IExecuteSetupMainProgramRequest): Promise<IExecuteSetupMainProgramResult> {
		this._onInit();

		const { api_resolver_program, data_model_modifier_program } = await this._createProgram(this.execution_context);
		const dmc_array = this.getDmcArray(dto.dm_manager);
		const errors = [] as IException[];
		let api_result = {} as IHttpResult<ApiResolverProgramResultDto>;

		try {
			//ActionMode에 따라 Menu Attr변경
			await this._onInitMenuAttr();

			//Pre Executer 실행

			const is_continue = await this._preExecuter(dmc_array, dto.vmc);
			if (_.vIsEquals(is_continue, false)) {
				return {
					additional_info: {},
					is_continue: false,
				};
			}

			const error_list = [] as IDataModelValidationDetail[];
			/* ----------- Dmc별 validator 실행 ----------- */
			for (const dmc of dmc_array) {
				data_model_modifier_program.executeAsync(dmc);
				// //첨부파일
				// if (dmc.data_model_id == this.master_data_model_id) {
				// 	await this._slipLink(dto.vmc, dmc);
				// }
				// Data Validator * UI에서 정상적으로 데이터 보내줄때까지 주석처리..
				error_list.push(...(await this._dataValidator(dto.vmc, dmc)));
			}

			if (!_.vIsEmpty(error_list)) {
				Exception.throw(
					ExceptionBuilder.create<IDataModelValidationException>(IDataModelValidationException, {
						data_model_id: error_list[0].data_model_id as string,
						details: error_list,
					})
				);
			}

			//API 호출
			this.api_request = this.getActionRequest(this.execution_context, dto);
			api_result = await api_resolver_program.executeAsync({
				attributes: this.menu_definition.attributes?.filter((x) => x.attr_type == EN_ATTR_TYPE.Api),
				action_request: this.api_request,
			});

			if (_.vIsEmpty(api_result.result.error) == false) {
				errors.push(api_result.result.error ?? ({} as IException));
			}
			//this.result.data_model = api_result.result.data_model;
			//	this.result = api_result.result;
			this.result.data_model = api_result.result.data_model;
			this.result.additional_info = api_result;
			this.result.slip_created_result = api_result.result.slip_created_result;
		} catch (e) {
			const ex = Exception.verifyOrThrow(e);
			errors.push(ex ?? ({} as IException));
		} finally {
			if (!_.vIsEmpty(errors)) {
				this.result.error = ExceptionBuilder.create<ICommonException>(ICommonException, {
					error_info: errors,
				});
			}
		}

		if (!_.vIsEmpty(errors)) {
			//validator resolver 실행
			const exResolver = await this._validatorResolver(api_result, dto);
			if (exResolver?.result) {
				this.result = exResolver.data;
			}
		}

		return this.result;
	}

	private _setOriginalDataModel(dto: IExecuteSetupMainProgramRequest) {
		const dmc_array = this.getDmcArray(dto.dm_manager);

		_.forEach(dmc_array, (dmc) => {
			dmc.setDataModel(this.original_data_model[dmc.getDMCId()]);
		});
	}

	/** */
	private async _preExecuter(dmc_array: any, vmc: IViewModelStateContainer): Promise<boolean> {
		const { pre_executer_program } = await this._createProgram(this.execution_context);
		const pre_executer_request_dto: IPreExecuterProgramDto = {
			dmc_array,
			additional_info: { check_valid_row: this.check_valid_row },
			vmc,
		};
		return await pre_executer_program.executeAsync(pre_executer_request_dto);
	}

	/** data_model_validator 실행 */
	private async _dataValidator(vmc: IViewModelStateContainer, dmc: IDataModelContainer) {
		const { validate_program } = await this._createProgram(this.execution_context);
		const validator_result = await (
			await validate_program
		).executeAsync({
			menu_type: EN_MENU_TYPE.Input,
			data_model_container: dmc,
			vmc: vmc,
			additional_info: {
				check_valid_row: this.check_valid_row[dmc.dmc_id] || {},
			},
			self_exception_tf: true,
		});

		return validator_result.exception.details;
	}

	// /** 첨부파일 */
	// private async _slipLink(vmc: IViewModelStateContainer, dmc: IDataModelContainer) {
	// 	const { slip_link_program } = await this._createProgram(this.execution_context);
	// 	// 첨부파일 체크

	// 	const slip_link_result = await (
	// 		await slip_link_program
	// 	).executeAsync({
	// 		dmc,
	// 		vmc,
	// 	});

	// 	if (slip_link_result == false) {
	// 		// 첨부 처리가 제대로 안된 것
	// 		vmc.alert('미확인 에러 - 첨부관련');
	// 		return;
	// 	}
	// }

	private convertValidatorDto(api_request: ActionDataBase<CommonRequestDto>): IActionRequestDto {
		const result: IActionRequestDto = {
			bizz_sid: api_request.bizz_sid,
			action_mode: api_request.action_mode,
			bizz_id: api_request.bizz_id,
			authority_type: api_request.authority_type,
			menu_type: api_request.menu_type,
			menu_sid: api_request.menu_sid,
			menu_nm: api_request.menu_nm,
			notification: api_request.data.notification,
			additional_info: api_request.data.additional_info,
			current_template: api_request.data.current_template,
			slip_data_model: [api_request.data.slip_data_model],
		};

		return result;
	}

	/** validator Resolver 실행 */
	private async _validatorResolver(
		result: IHttpResult<ApiResolverProgramResultDto>,
		dto: IExecuteSetupMainProgramRequest
	) {
		if (result.status == HttpStatusCodes.OK) {
			let validator_resolver_result: IExResolver<any> = { result: false };
			if (!_.isEmpty(result.result.error)) {
				const { validator_resolver_program } = await this._createProgram(this.execution_context);
				for (const error_info of (result.result.error as ICommonException)?.error_info || []) {
					for (const exception of (error_info as IValidateSlipDataModelException)?.exceptions || []) {
						const validator_resolver_program_request_dto: ISlipValidatorResolverProgramRequestDto = {
							execution_context: this.execution_context,
							action_request: this.convertValidatorDto(this.api_request), //slip_data_model 맞춰야 함.
							vmc: dto.vmc,
							dm_manager: dto.dm_manager,
							exception: exception,
							program_identifier: dto.program_identifier,
						};

						validator_resolver_result = await (
							await validator_resolver_program
						).executeAsync(validator_resolver_program_request_dto);

						// 추가
						if (!validator_resolver_result.result) break;
					}
				}
				if (!validator_resolver_result.result) {
					Exception.throw(
						ExceptionBuilder.create(result.result.error?.name as string, result.result.error as IException)
					);
					// 500에러가 아니기 때문에 직접 throw
				}
			} else {
				if (!_.isEmpty(dto.program_identifier)) {
					const program_request_dto: ICreateAndModifyAccountSaveButtonTypeRequestDto = {
						dm_manager: dto.dm_manager,
						vmc: dto.vmc,
						result: result,
					};
					const program = await ProgramBuilder.createAsync(
						dto.program_identifier as ProgramIdentifier,
						this.execution_context
					);
					await program.executeAsync(program_request_dto);
				}
			}

			return validator_resolver_result;
		}
	}
	/** init menu attr */
	private async _onInitMenuAttr() {
		const { set_menu_attr_program } = await this._createProgram(this.execution_context);
		await set_menu_attr_program.executeAsync({
			action_mode: this.execution_context.action.action_mode as EN_ACTION_MODE,
			bizz_sid: this.execution_context.action.bizz_sid,
			menu_sid: this.execution_context.action.menu_sid as string,
			menu_type: this.execution_context.action.menu_type as EN_MENU_TYPE,
		});
	}

	/** init request */
	private _onInit() {
		const definition_feature = this.execution_context.getFeature<manager.IBizzManager>(manager.IBizzManager);
		this.check_valid_row = {};

		this.menu_definition = definition_feature.getMenuDefinition(
			this.execution_context,
			this.execution_context.action.bizz_sid,
			this.execution_context.action.menu_sid ?? (this.execution_context.action.menu_type as string)
		) as IMenuDefinition;

		this.master_data_model_id = definition_feature.getBizzDataModelId(
			this.execution_context,
			this.execution_context.action.bizz_sid,
			EN_INPUT_MENU_TYPE.Master
		);

		this.result = {
			additional_info: {},
			is_continue: true,
		};
	}

	/**
	 *  Init - Create program
	 */
	private async _createProgram(context: IExecutionContext) {
		return {
			set_menu_attr_program: await ProgramBuilder.createAsync<ISlipDataModel, void>(ISetMenuAttrProgram, context),
			api_resolver_program: await ProgramBuilder.createAsync<
				ApiResolverProgramRequestDto,
				IHttpResult<ApiResolverProgramResultDto>
			>(IApiResolverProgram, context),
			pre_executer_program: await ProgramBuilder.createAsync<IPreExecuterProgramDto, IPreExecuterProgramResult>(
				IPreExecuterProgram,
				context
			),
			validate_program: await ProgramBuilder.createAsync<
				IDataModelValidatorRequestDto<IDataModelContainer>,
				IDataModelValidatorResultDto,
				IDataModelValidatorProgram
			>(IDataModelValidatorProgram, context),
			// slip_link_program: await ProgramBuilder.createAsync<
			// 	ISetSlipLinkProgramRequest,
			// 	boolean,
			// 	ISetSlipLinkProgram
			// >(ISetSlipLinkProgram, context),
			validator_resolver_program: await ProgramBuilder.createAsync<
				ISlipValidatorResolverReturnProgramRequestDto,
				IExResolver<any>,
				ISlipValidatorResolverReturnProgram
			>(ISlipValidatorResolverReturnProgram, context),
			data_model_modifier_program: await ProgramBuilder.createAsync<IDataModelContainer, IDataModelContainer>(
				IDataModelModifierProgram,
				context
			),
		};
	}

	private getDmcArray(dm_manager: IDMManager): IDataModelContainer<any, any>[] {
		const dmc_mapper = dm_manager.getDmcMapper();
		const no_definition_models = [
			'head',
			'footer_toolbar',
			'checked_toolbar',
			'unchecked_toolbar',
			'notification_master_input',
			'notification_master_remove',
			'cust_code_list',
			'prod_code_list',
		];

		const definition_feature = this.execution_context.getFeature<manager.IBizzManager>(manager.IBizzManager);
		const bizz_sid_no_definition_models = ['inventory_pre_calc_item', 'myFavoriteCode'];
		bizz_sid_no_definition_models.forEach((no_definition_model) => {
			const data_model_id = definition_feature.getBizzDataModelId(
				this.execution_context,
				this.execution_context.action.bizz_id || '',
				no_definition_model
			);
			no_definition_models.push(data_model_id);
		});

		const dmc_array = _.filter(dmc_mapper, (dmc) => {
			return !no_definition_models.includes(dmc.dmc_id);
		});

		return dmc_array;
	}

	_getGroupIds(dmc: DataModelContainer<any, any>): string[] {
		const groupids = dmc.getPropGroupIdList<group_type_sync_data>(
			(group) =>
				group.group_type == EN_PROP_GROUP_TYPE.sync &&
				group.data?.target?.type == EN_PROP_GROUP_SYNCTARGET_TYPE.prop
		);
		return groupids || [];
	}

	private getActionRequest(
		execution_context: IExecutionContext,
		request: IExecuteSetupMainProgramRequest,
		callback?: (dmc: IDataModelContainer) => void
	): ActionDataBase<CommonRequestDto> {
		const { bizz_sid, menu_sid, menu_type, action_mode } = execution_context.action;
		const dmc_array = this.getDmcArray(request.dm_manager);
		const data_model: { [key: string]: any } = {};
		let data_dt = '',
			data_no = 0,
			data_sid = '',
			confirm_type = '';

		for (const dmc of dmc_array) {
			const data_model_id = dmc.dmc_id;
			callback && callback(dmc);

			const new_dmc = new DataModelContainer(dmc.serialize(), dmc.getDefinition());

			const groupids = this._getGroupIds(new_dmc);
			for (const gid of groupids) {
				new_dmc.executePropGroups(gid);
			}

			if (data_model_id == this.master_data_model_id) {
				data_dt = new_dmc.getValueByReferType('data_dt') as string;
				data_no = new_dmc.getValueByReferType('data_no') as number;
				data_sid = new_dmc.getValueByReferType('data_sid') as string;
				confirm_type = new_dmc.getValueByReferType('confirm_type') as string;
			}

			data_model[data_model_id] = _.filter(new_dmc.getDataModel(), (row, index) => {
				return !_.vIsEquals(this.check_valid_row[new_dmc.data_model_id]?.[index], false);
			});
		}
		data_model[
			this.execution_context.bizz_mgr.getBizzDataModelId(
				this.execution_context,
				this.execution_context.action.bizz_sid,
				EN_DATA_MODEL_ID.Notification
			)
		] = request.dm_manager.getDataModelContainer(EN_DATA_MODEL_ID.Notification)?.getDataModel();
		const attr_feature = this.execution_context.getFeature<attribute.IAttributeFeature>(
			attribute.IAttributeFeature
		);
		const is_from_approval = attr_feature.getMenuAttr<menu_attrs.is_from_approval>(
			menu_attrs.is_from_approval
		)?.data;
		//	const slips = request.slips;

		const program_request_dto: ActionDataBase<CommonRequestDto> = {
			bizz_sid,
			action_mode,
			menu_sid,
			menu_type,
			data: {
				bizz_sid,
				additional_info: {
					...request.additional_info,
					is_from_approval,
					confirm_type,
					//	slips,
				},
				slip_data_model: {
					bizz_sid,
					menu_sid,
					menu_type,
					action_mode,
					data_model,
					data_dt,
					data_no,
					data_sid,
				} as ISlipDataModel,
				current_template: request.current_template,
				is_za_from_only: request.is_za_from_only,
			},
		};

		return program_request_dto;
	}

	// //권한 조회 api
	// getConfirmAuthority = async () => {
	// 	const auth_type = this.execution_context.user.slip_auth_type;
	// 	if (auth_type === '1') {
	// 		return [];
	// 	}

	// 	let result: BulkCheckAuthorityResultDto[] = [];
	// 	try {
	// 		const http = this.execution_context.getFeature<system.IHttpRequestFeature>(system.IHttpRequestFeature);
	// 		const v3_api_result = await http.sendAsync<BulkCheckAuthorityRequestDto[], BulkCheckAuthorityResultDto[]>(
	// 			IBulkCheckAuthorityAction,
	// 			{
	// 				data: [
	// 					{
	// 						bizz_sid: this.execution_context.action.bizz_sid,
	// 						authority_type: EN_AUTHORITY_TYPE.Confirm,
	// 						menu_sid: this.execution_context.action.menu_sid,
	// 					},
	// 				],
	// 			}
	// 		);

	// 		result = v3_api_result.result;
	// 	} catch (ex: any) {
	// 		Exception.throw(ExceptionBuilder.create<IGeneralException>(IGeneralException, ex));
	// 	}
	// 	return result;
	// };
}
