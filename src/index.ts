import express, {Express, Request, Response} from 'express';
import { logger } from 'inlada-logger';
import cors from 'cors';
import {
  actionProcessorFactory,
  contractProviderFactory,
  eventFactoryFactory,
  eventPreprocessorFactory,
  eventProcessorFactory,
  IActionRedirect,
  IAnyEvent, IEntityRelation,
  IError,
  IEvent,
  IHandler,
  IObjectInfo,
  IPlugin,
  IPluginSet,
  ITransformation,
  ITransformFn,IResultError
} from 'inladajs';



// todo rename to httpResult ?
interface IExpressHandlerResult {
  statusCode: number
  body: any
  headers: any
}

export enum RESPONSE_STATUS {
  ok = 200,
  noAccess = 403,
  notFound = 404,
  error = 500,
}

export const response = (status = RESPONSE_STATUS.ok, body: any): IExpressHandlerResult => ({
  statusCode: status,
  headers: {
    'Content-Type': 'application/json',
  },
  body,
});

export const responseError = (error: {error?: IResultError<any>}) => {
  const errorObject = { error: error.error };
  return response(error.error?.status || RESPONSE_STATUS.error, errorObject);
};

export const responseFatalError = (exception : any) => {
  const errorObject = { error: exception.toString() };

  logger.error(null, exception.event?.uid, exception.stack, exception.message)

  return response(RESPONSE_STATUS.error, errorObject);
};

export const responseNotError = <TEvent extends IAnyEvent>(event: TEvent) => {
  let result;
  // 1. have error field set
  if (event.error) {
    result = {
      error: event.error,
    };
  } else if (typeof event.result === 'object') {
    if (Array.isArray(event.result)) { // list
      result = event.result;
    } else if (event.result === null) { // empty detail
      result = null;
    } else {
      result = event.result;
    }
  } else {
    // not object, f.e. bool
    result = event.result;
  }

  return response(event.error?.status || RESPONSE_STATUS.ok, result);
};


interface IHandlerFactoryParam <
  TACTION_NAMES extends string,
  TERROR_NAMES extends string,
  TOBJECT_NAMES extends string,
  TOPTION_NAMES extends string,
  TPLUGIN_NAMES extends string,
  TPLUGIN_SET_NAMES extends string,
  TEvent extends IEvent<TACTION_NAMES, TERROR_NAMES, TOBJECT_NAMES, TOPTION_NAMES, TPLUGIN_NAMES>
  > {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  plugins: IPlugin<TACTION_NAMES, TPLUGIN_NAMES, TEvent>[] | IPluginSet<TACTION_NAMES, TPLUGIN_NAMES, TPLUGIN_SET_NAMES, TEvent>
  errors: Record<TERROR_NAMES, IError<TERROR_NAMES, TEvent>>,
  fullObjectsInfo: Partial<Record<TOBJECT_NAMES, IObjectInfo<TOBJECT_NAMES>>>,
  relations: IEntityRelation<TOBJECT_NAMES>[],
  EventConstructor: any, // todo type
  allowedActions: Partial<Record<TOBJECT_NAMES, TACTION_NAMES[]>>,
  allowedOptions: TOPTION_NAMES[],
  actionRedirect: IActionRedirect<TACTION_NAMES, TOBJECT_NAMES>,
  customEventPreprocessor: (event: Record<string, unknown>) => Promise<Record<string, unknown>>,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  contracts: Partial<Record<TOBJECT_NAMES, ITransformation<TACTION_NAMES, TEvent>>>,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  fnBeforeEvery?: ITransformFn<TEvent>,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  fnAfterAll?: ITransformFn<TEvent>,
}

export const handlerFactory = <
  TACTION_NAMES extends string,
  TERROR_NAMES extends string,
  TOBJECT_NAMES extends string,
  TOPTION_NAMES extends string,
  TPLUGIN_NAMES extends string,
  TPLUGIN_SET_NAMES extends string,
  TEvent extends IEvent<TACTION_NAMES, TERROR_NAMES, TOBJECT_NAMES, TOPTION_NAMES, TPLUGIN_NAMES>
  > ({
       plugins,
       errors,
       fullObjectsInfo,
       relations,
       EventConstructor,
       allowedActions,
       allowedOptions,
       actionRedirect,
       customEventPreprocessor,
       contracts = {},
       fnBeforeEvery,
       fnAfterAll,
     }: IHandlerFactoryParam<TACTION_NAMES, TERROR_NAMES, TOBJECT_NAMES, TOPTION_NAMES, TPLUGIN_NAMES, TPLUGIN_SET_NAMES, TEvent>,
) : IHandler<TEvent> => {
  const actionProcessor = actionProcessorFactory<TACTION_NAMES, TPLUGIN_NAMES, TEvent>(plugins);
  const eventFactory = eventFactoryFactory<
    TACTION_NAMES, TERROR_NAMES, TOBJECT_NAMES, TOPTION_NAMES, TPLUGIN_NAMES, TEvent
    >(errors, fullObjectsInfo, relations, EventConstructor);
  const eventPreprocessor = eventPreprocessorFactory<
    TACTION_NAMES, TOBJECT_NAMES, TOPTION_NAMES
    >(allowedActions, allowedOptions as TOPTION_NAMES[], actionRedirect, customEventPreprocessor);
  const contractProvider = contractProviderFactory<
    TACTION_NAMES, TOBJECT_NAMES, TEvent
    >(contracts, fnBeforeEvery, fnAfterAll); // todo add empty newsletter to package
  const eventProcessor = eventProcessorFactory<
    TACTION_NAMES, TERROR_NAMES, TOBJECT_NAMES, TOPTION_NAMES, TPLUGIN_NAMES, TEvent
    >(contractProvider, actionProcessor, eventFactory);

  return async (eventBody: Record<string, unknown>, objectName: string, actionName: string, actionNameType?: string) => {
    const { rawEvent, rawAction } = await eventPreprocessor.makeRawEvent(eventBody, objectName, actionName, actionNameType);
    return eventProcessor.processRequest(rawEvent, rawAction);
  };
};

export const handlerExpressFactory = <
  TACTION_NAMES extends string,
  TERROR_NAMES extends string,
  TOBJECT_NAMES extends string,
  TOPTION_NAMES extends string,
  TPLUGIN_NAMES extends string,
  TPLUGIN_SET_NAMES extends string,
  TEvent extends IEvent<TACTION_NAMES, TERROR_NAMES, TOBJECT_NAMES, TOPTION_NAMES, TPLUGIN_NAMES>
  > (params: IHandlerFactoryParam<TACTION_NAMES, TERROR_NAMES, TOBJECT_NAMES, TOPTION_NAMES, TPLUGIN_NAMES, TPLUGIN_SET_NAMES, TEvent>,
) : { httpHandler: IHandler<IExpressHandlerResult>,handler: IHandler<TEvent> } => {

  const handler = handlerFactory(params);
  const httpHandler = async (eventBody: Record<string, unknown>, objectName: string, actionName: string, actionNameType?: string) => {
    try {
      const resultEvent = await handler(eventBody, objectName, actionName, actionNameType);
      if (resultEvent.error) {
        return responseError(resultEvent);
      }
      return responseNotError(resultEvent);
    } catch (ex) {
      return responseFatalError(ex);
    }
  };

  return { handler, httpHandler };
};

const expressHandler = (handler: IHandler<IExpressHandlerResult>) => async (req: Request, res: Response) => {
  try {
    const { objectname: objectName, actionname: actionName, actionnametype: actionNameType } = req.params;

    const lambdaRes = await handler(req.body, objectName, actionName, actionNameType);

    // todo move inside eventAdaptor
    if (lambdaRes.headers) {
      res.set(lambdaRes.headers);
    }
    return res.status(lambdaRes.statusCode).send(lambdaRes.body);
  } catch (e: any) {
    return res.status(500).send(`Lambda failed, ${e}, ${e?.stack}`);
  }
};

export const addHandlerToExpressApp = <
  TACTION_NAMES extends string,
  TERROR_NAMES extends string,
  TOBJECT_NAMES extends string,
  TOPTION_NAMES extends string,
  TPLUGIN_NAMES extends string,
  TPLUGIN_SET_NAMES extends string,
  TEvent extends IEvent<TACTION_NAMES, TERROR_NAMES, TOBJECT_NAMES, TOPTION_NAMES, TPLUGIN_NAMES>
  >(app: Express, params: IHandlerFactoryParam<TACTION_NAMES,TERROR_NAMES,TOBJECT_NAMES,TOPTION_NAMES,TPLUGIN_NAMES,TPLUGIN_SET_NAMES,TEvent>
): IHandler<TEvent> => {

  const { httpHandler, handler } = handlerExpressFactory(params);

  app.post('/:objectname/:actionname', expressHandler(httpHandler));
  app.post('/:objectname/:actionname/:actionnametype', expressHandler(httpHandler));

  return handler;
}

export const initExpressTransport = <
  TACTION_NAMES extends string,
  TERROR_NAMES extends string,
  TOBJECT_NAMES extends string,
  TOPTION_NAMES extends string,
  TPLUGIN_NAMES extends string,
  TPLUGIN_SET_NAMES extends string,
  TEvent extends IEvent<TACTION_NAMES, TERROR_NAMES, TOBJECT_NAMES, TOPTION_NAMES, TPLUGIN_NAMES>
  >(port: number, params: IHandlerFactoryParam<TACTION_NAMES,TERROR_NAMES,TOBJECT_NAMES,TOPTION_NAMES,TPLUGIN_NAMES,TPLUGIN_SET_NAMES,TEvent>
): Promise<{ app: Express, handler: IHandler<TEvent> }> =>
  new Promise(res => {
    const app = express();
    app.use(cors());
    app.use(express.json());
    app.use(express.urlencoded());

    const handler = addHandlerToExpressApp(app, params);

    app.listen(port, () => {
      logger.log(`listening ${port}`);
      res({ app, handler });
    });
});

