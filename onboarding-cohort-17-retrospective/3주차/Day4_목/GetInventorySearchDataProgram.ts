import { EN_AGGREGATE_TYPE, EN_MENU_TYPE } from 'ecount.fundamental.define/enum';
import { IBizz, IMenu, ISetup, ITenant, IUser } from 'ecount.infra.base/setup';
import { IExecutionContext } from 'ecount.infra.bridge/base';
import { my, pg } from 'ecount.infra.bridge/table_model';
import { program_impl } from 'ecount.infra.common/decorator';
import { BaseProgram, ProgramBuilder } from 'ecount.infra.common/program';
import { menu_attrs } from 'ecount.usecase.base/@abstraction';
import {
	GetPsConnSidRequestDto,
	GetV3EcmnPrgMgmtRequestDto,
	IBizzAttrGeneratorProgram,
	IGetPsConnSidProgram,
	IMenuAttrGeneratorProgram,
	IMenuAttrGeneratorProgramReqeustDto,
	IMenuHeaderGeneratorProgram,
	IMenuHeaderGeneratorProgramReqeustDto,
	ITenantAttrGeneratorProgram,
	IUserAttrGeneratorProgram,
} from 'ecount.usecase.common/@abstraction';
import {
	GetInventorySetupRequestDto,
	GetInventorySetupResultDto,
	IGetInventorySearchDataProgram,
} from 'ecount.usecase.inventory/@abstraction';
import { SvcCommandBuilder } from 'ecount.infra.common/svc';
import { DataModelTestValidatorSvc } from '../svc';

/**
 * UI 용 Search 데이터 가져오기
 */
@program_impl(IGetInventorySearchDataProgram)
export class GetInventorySearchDataProgram
	extends BaseProgram<GetInventorySetupRequestDto, GetInventorySetupResultDto>
	implements IGetInventorySearchDataProgram
{
	constructor(execution_context: IExecutionContext) {
		super(execution_context);
	}

	onExecute(dto: GetInventorySetupRequestDto): GetInventorySetupResultDto {
		const result = {
			tenant: {} as ITenant,
			user: {} as IUser,
			bizz: {} as IBizz,
			menu: {} as IMenu,
			function: [],
			data_model: {},
			data_model_definitions: {},
			view_container: [],
			from_bizz_info: dto.from_bizz_info,
		} as ISetup;

		result.menu = {
			attributes: [],
		};

		const tenant_attr_program = ProgramBuilder.create<ISetup, ISetup>(
			ITenantAttrGeneratorProgram,
			this.execution_context
		);
		tenant_attr_program.execute(result);

		const user_action_attr_program = ProgramBuilder.create<ISetup, ISetup>(
			IUserAttrGeneratorProgram,
			this.execution_context
		);
		user_action_attr_program.execute(result);

		const bizz_action_attr_program = ProgramBuilder.create<ISetup, ISetup>(
			IBizzAttrGeneratorProgram,
			this.execution_context
		);
		bizz_action_attr_program.execute(result);

		const attr_list = [menu_attrs.preset, menu_attrs.bookmark, menu_attrs.header_data_model_id];
		const menu_attr_program = ProgramBuilder.create<IMenuAttrGeneratorProgramReqeustDto, ISetup>(
			IMenuAttrGeneratorProgram,
			this.execution_context
		);
		menu_attr_program.execute({ setup: result });
		menu_attr_program.execute({ setup: result, attr_list: attr_list });

		result.menu.name = this._getMenuName(result.menu);
		this._getSearchTemplate(result);

		// Header 생성 프로그램 호출
		const menu_header_program = ProgramBuilder.create<IMenuHeaderGeneratorProgramReqeustDto, ISetup>(
			IMenuHeaderGeneratorProgram,
			this.execution_context
		);
		menu_header_program.execute({ setup: result });

		const testSvc = SvcCommandBuilder.create(DataModelTestValidatorSvc, this.execution_context);
		testSvc.execute(dto);

		return result;
	}

	private _getMenuName(menu: IMenu): string {
		const menu_info = menu.attributes.find((x) => _.vIsEquals(x.attr_id, 'v3_menu_info'))?.data;
		let prg_id: string;

		switch (this.execution_context.action.menu_type) {
			case EN_MENU_TYPE.ListSearch: {
				prg_id = menu_info.list.prg_id;
				break;
			}
			case EN_MENU_TYPE.StatusSearch: {
				prg_id = menu_info.status.prg_id;
				break;
			}
			case EN_MENU_TYPE.PopupSearch: {
				prg_id = menu_info.popup.prg_id;
				break;
			}
			case EN_MENU_TYPE.OutstandingStatusSearch: {
				prg_id = menu_info.outstandingstatus.prg_id;
				break;
			}
			default: {
				const program = ProgramBuilder.create<GetPsConnSidRequestDto, pg.ps_common_cd_m>(
					IGetPsConnSidProgram,
					this.execution_context
				);
				const cnnt_i_result = program.execute({
					bizz_sid: this.execution_context.action.bizz_sid,
					calling_file_name: 'GetInventorySearchDataProgram.ts',
				});
				prg_id = _.vSafe(cnnt_i_result?.prg_id);
			}
		}

		const prg_mgmt = _.vSafe<my.ecmn_prg_mgmt>(
			this.execution_context.entity.fetch<my.ecmn_prg_mgmt, GetV3EcmnPrgMgmtRequestDto>(
				my.ecmn_prg_mgmt,
				this.execution_context,
				{
					prg_id: _.vSafe(prg_id),
				}
			),
			{}
		);
		return _.vSafe(prg_mgmt.resx_code3);
	}

	private _getSearchTemplate(setup: ISetup) {
		setup.data_model.search_template = {
			applied_template: _.vSafe(
				setup.menu.attributes.find((x) => _.vIsEquals(x.attr_id, 'template_info'))?.data?.[
					EN_AGGREGATE_TYPE.Details
				]?.current_template
			),
		};
	}
}
