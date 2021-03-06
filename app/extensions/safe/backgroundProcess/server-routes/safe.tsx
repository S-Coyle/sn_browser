import { parse } from 'url';
import React from 'react';
import ReactDOMServer from 'react-dom/server';

import { logger } from '$Logger';
import { Error, ERROR_TYPES, ERROR_CODES } from '$Components/PerusePages/Error';
import { addTab } from '$Actions/tabs_actions';
import { errorConstants } from '$Extensions/safe/err-constants';
import {
    rangeStringToArray,
    generateResponseString,
    cleanupNeonError,
} from '$Extensions/safe/utils/safeHelpers';
import { getHTTPFriendlyData } from '$Extensions/safe/backgroundProcess';
import { SAFE } from '$Extensions/safe/constants';
import {
    windowCloseTab,
    addTabEnd,
    addTabNext,
} from '$Actions/windows_actions';

export const safeRoute = ( store ) => ( {
    method: 'GET',
    path: /safe:\//,
    handler: async ( request, response ) => {
        const sendErrorResponse = (
            type: string,
            address?: string,
            badVersion?: string,
            latestVersion?: string
        ): void => {
            const page = ReactDOMServer.renderToStaticMarkup(
                <Error
                    type={type}
                    address={address}
                    badVersin={badVersion}
                    latestVersion={latestVersion}
                />
            );
            logger.debug( 'Constructing error page of type:', type, page );
            response
            // Commented out until electron stops swallowing response body:
            // https://github.com/electron/electron/issues/21046
            // .status( ERROR_CODES[type] )
                .send( page );
        };

        try {
            let link = request.url;
            link = link.slice( 1 ); // remove initial slash

            if ( link.endsWith( '/' ) ) {
                link = link.slice( 0, -1 );
            }

            const { headers } = request;
            let isRangeRequest = false;
            let multipartRequest = false;

            let start;
            let end;
            let rangeArray;

            logger.info( `Handling SAFE req: ${link}` );

            if ( headers.range ) {
                isRangeRequest = true;
                rangeArray = rangeStringToArray( headers.range );

                if ( rangeArray.length > 1 ) {
                    multipartRequest = true;
                }
            }

            // setup opts object
            const options = { headers };

            if ( isRangeRequest ) {
                options.range = rangeArray;
            }

            let data = null;
            const parseTheQueryString = true;
            const parsed = parse( link, parseTheQueryString );
            const targetVersion = parsed.query ? parsed.query.v : undefined;

            try {
                data = await getHTTPFriendlyData( link, store );
            } catch ( error ) {
                const message = cleanupNeonError( error );
                logger.warn( 'error with http friendly data', message, error.code );

                if ( targetVersion && message.includes( `Content not found at ${link}` ) ) {
                    return sendErrorResponse( ERROR_TYPES.NO_CONTENT_FOUND );
                }

                if (
                    message.includes( `Content not found at ${link}` ) &&
          parsed.path !== '/'
                ) {
                    const safeHost = `safe://${parsed.host}`;

                    try {
                        // we had a path, lets try the root domain...
                        data = await getHTTPFriendlyData( safeHost, store );
                    } catch ( newError ) {
                        const newMessage = cleanupNeonError( newError );
                        logger.warn(
                            `Attempted to source root domain safe://${parsed.host}`,
                            newMessage
                        );

                        return sendErrorResponse( ERROR_TYPES.UNKNOWN_NAME, link );
                    }

                    return sendErrorResponse( ERROR_TYPES.INVALID_VERSION, link );
                }

                logger.error( `Content not found at: ${link}` );
                return sendErrorResponse( ERROR_TYPES.NO_CONTENT_FOUND );

                // return;
                //       const shouldTryAgain =
                // error.code === errorConstants.ERR_OPERATION_ABORTED.code ||
                // error.code === errorConstants.ERR_ROUTING_INTERFACE_ERROR.code ||
                // error.code === errorConstants.ERR_REQUEST_TIMEOUT.code;
                //       if ( shouldTryAgain ) {
                //           const { safeBrowserApp } = store.getState();
                //           if ( safeBrowserApp.networkStatus === SAFE.NETWORK_STATE.CONNECTED ) {
                //               store.getState().tabs.forEach( ( tab ) => {
                //                   logger.info( tab.url, link, link.includes( tab.url ) );
                //                   if ( link.includes( tab.url ) && !tab.isActive ) {
                //                       store.dispatch( windowCloseTab( { tabId: tab.tabId } ) );
                //                   }
                //               } );
                //               const tabId = Math.random().toString( 36 );
                //               /* eslint-disable no-undef */
                //               const currentWebContentsId = remote
                //                   ? remote.getCurrentWebContents().id
                //                   : 1;
                //               // this is mounted but its not show?
                //               /* eslint-enable no-undef */
                //               const windowId = currentWebContentsId;
                //               store.dispatch( addTab( { url: link, tabId } ) );
                //               store.dispatch( addTabEnd( { tabId, windowId } ) );
                //           }
                //
                //           error.message = errorConstants.ERR_ROUTING_INTERFACE_ERROR.msg;
                //           return sendErrResponse( error.message );
                //       }
                //       return sendErrResponse( message );
            }

            if ( isRangeRequest && multipartRequest ) {
                const responseString = generateResponseString( data );
                return response.set( data.headers ).send( responseString );
            }
            if ( isRangeRequest ) {
                return response.status( 206 ).set( data.headers ).send( data.body );
            }

            return response.set( data.headers ).send( data.body );
        } catch ( error ) {
            logger.error( error );

            const problemLink = request.url;

            if ( error.code && error.code === -302 ) {
                return response.status( 416 ).send( 'Requested Range Not Satisfiable' );
            }

            const message = cleanupNeonError( error );

            logger.error( message );
            return sendErrorResponse( ERROR_TYPES.BAD_REQUEST, problemLink );
        }
    },
} );
