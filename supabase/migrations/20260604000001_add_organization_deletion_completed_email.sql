-- Seed the 'organization-deletion-completed' template
-- Sent by the sendOrganizationDeletedEmail edge function once an organization's
-- 30-day recovery window has elapsed and the organization has been permanently
-- deleted. Supports a {{business_name}} placeholder substituted at send time.
INSERT INTO public.email_templates (name, subject, content)
VALUES (
    'organization-deletion-completed',
    'Your organization "{{business_name}}" has been permanently deleted',
    '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
   <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
      <title>Organization deleted</title>
      <style>@media (max-width: 450px) { .layout-0 { display: none !important; } } @media (max-width: 450px) and (min-width: 0px) { .layout-0-under-450 { display: table !important; } }</style>
   </head>
   <body style="width:100%;background-color:#f0f1f5;margin:0;padding:0">
      <table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#f0f1f5">
         <tbody>
            <tr>
               <td style="background-color:#f0f1f5">
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;min-height:600px;margin:0 auto;background-color:#111826">
                     <tbody>
                        <tr>
                           <td style="vertical-align:top;padding:10px 0px">
                              <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                                 <tbody>
                                    <tr>
                                       <td style="padding:10px 0 10px 0;vertical-align:top">
                                          <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="color:#000;font-family:Arial, Helvetica, sans-serif;">
                                             <tbody>
                                                <tr>
                                                   <td>
                                                      <table cellpadding="0" cellspacing="0" border="0" style="width:100%">
                                                         <tbody>
                                                            <tr>
                                                               <td align="center">
                                                                  <table cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">
                                                                     <tbody>
                                                                        <tr>
                                                                           <td style="width:100%;padding:0"><img src="https://iywivotqnphrjijztxtu.supabase.co/storage/v1/object/public/images/placeholders/998920d2c1dd57b216578453151600c4.png" alt="DoorKnocker Header" width="600" height="180" style="display:block;width:100%;height:auto;max-width:100%"></td>
                                                                        </tr>
                                                                     </tbody>
                                                                  </table>
                                                               </td>
                                                            </tr>
                                                         </tbody>
                                                      </table>
                                                   </td>
                                                </tr>
                                                <tr>
                                                   <td style="font-size:0;height:16px" height="16">&nbsp;</td>
                                                </tr>
                                                <tr>
                                                   <td dir="ltr" style="color:#eb7526;font-size:29.3333px;font-weight:700;letter-spacing:-0.04em;line-height:1;text-align:center;padding:0px 20px">Organization deleted<br></td>
                                                </tr>
                                                <tr>
                                                   <td style="font-size:0;height:16px" height="16">&nbsp;</td>
                                                </tr>
                                                <tr>
                                                   <td style="padding:0px 20px">
                                                      <table border="0" cellpadding="0" cellspacing="0" class="layout-0" align="center" style="display:table;width:100%;max-width:451px;margin:0 auto;">
                                                         <tbody>
                                                            <tr>
                                                               <td style="padding:17px">
                                                                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="color:#ffffff;">
                                                                     <tbody>
                                                                        <tr>
                                                                           <td dir="ltr" style="font-size:14.6667px;text-align:center;">Your organization <strong>{{business_name}}</strong> has reached the end of its 30-day recovery window.</td>
                                                                        </tr>
                                                                        <tr>
                                                                           <td style="font-size:0;height:16px" height="16">&nbsp;</td>
                                                                        </tr>
                                                                        <tr>
                                                                           <td dir="ltr" style="font-size:14.6667px;text-align:center;">It has now been permanently deleted, along with all of its associated data. This action cannot be undone.</td>
                                                                        </tr>
                                                                        <tr>
                                                                           <td style="font-size:0;height:16px" height="16">&nbsp;</td>
                                                                        </tr>
                                                                     </tbody>
                                                                  </table>
                                                               </td>
                                                            </tr>
                                                         </tbody>
                                                      </table>
                                                   </td>
                                                </tr>
                                                <tr>
                                                   <td style="font-size:0;height:16px" height="16">&nbsp;</td>
                                                </tr>
                                                
                                                <tr>
                                                   <td style="font-size:0;height:40px" height="40">&nbsp;</td>
                                                </tr>
                                                <tr>
                                                   <td align="center"><img src="https://iywivotqnphrjijztxtu.supabase.co/storage/v1/object/public/images/placeholders/60d9999ce6b56d49fe39dc0a56f13c98.png" alt="DoorKnocker Logo" width="185" height="69"></td>
                                                </tr>
                                                <tr>
                                                   <td style="font-size:0;height:16px" height="16">&nbsp;</td>
                                                </tr>
                                                <tr>
                                                   <td dir="ltr" style="font-size:13.3334px;color:#e8e8e8;text-align:center;padding:0px 20px">info@texasgrowthfactory.com  &bull;  www.texasgrowthfactory.com<br>737-239-8500  &bull;  12600 Hill Country Boulevard<br>Suite R-275 &ndash; #281 Bee Cave, TX 78738</td>
                                                </tr>
                                             </tbody>
                                          </table>
                                       </td>
                                    </tr>
                                 </tbody>
                              </table>
                           </td>
                        </tr>
                     </tbody>
                  </table>
               </td>
            </tr>
         </tbody>
      </table>
   </body>
</html>'
)
ON CONFLICT (name) DO UPDATE
SET subject = EXCLUDED.subject,
    content = EXCLUDED.content;
