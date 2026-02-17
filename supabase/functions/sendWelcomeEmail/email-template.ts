export const WELCOME_EMAIL_HTML = `<!DOCTYPE html>
<html>
    <head>
        <meta charset="utf-8">
        <title>Welcome to DoorKnocker</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                line-height: 1.6;
                color: #333;
            }
            .container {
                max-width: 600px;
                margin: 0 auto;
                padding: 20px;
            }
            .header {
                background-color: #f8f9fa;
                padding: 20px;
                text-align: center;
            }
            .content {
                padding: 20px;
            }
            .footer {
                text-align: center;
                font-size: 12px;
                color: #666;
                margin-top: 20px;
            }
            .button {
                display: inline-block;
                padding: 10px 20px;
                background-color: #007bff;
                color: white;
                text-decoration: none;
                border-radius: 5px;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Welcome to DoorKnocker!</h1>
            </div>
            <div class="content">
                <p>Hello,</p>
                <p>
                    We're excited to have you on board. Your account has been
                    successfully created.
                </p>
                <p>Click the button below to get started:</p>
                <p>
                    If you have any questions, feel free to reply to this email.
                </p>
            </div>
            <div class="footer">
                <p>&copy; 2026 DoorKnocker. All rights reserved.</p>
            </div>
        </div>
    </body>
</html>
`;
