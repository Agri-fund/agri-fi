import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';

export const runtime = 'edge';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { searchParams } = new URL(request.url);
    const commodity = searchParams.get('commodity') || 'Trade Deal';
    const value = searchParams.get('value') || '0';

    return new ImageResponse(
      (
        <div
          style={{
            height: '100%',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#f0fdf4', // bg-green-50
            backgroundImage: 'radial-gradient(circle at 25px 25px, #dcfce7 2%, transparent 0%), radial-gradient(circle at 75px 75px, #dcfce7 2%, transparent 0%)',
            backgroundSize: '100px 100px',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'white',
              padding: '40px 60px',
              borderRadius: '24px',
              border: '2px solid #bbf7d0', // border-green-200
              boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
            }}
          >
            <div
              style={{
                fontSize: 60,
                fontWeight: 'bold',
                color: '#166534', // text-green-800
                textTransform: 'capitalize',
                marginBottom: 10,
              }}
            >
              {commodity}
            </div>
            <div
              style={{
                fontSize: 30,
                color: '#15803d', // text-green-700
                marginBottom: 30,
              }}
            >
              Agri-Fi Trade Opportunity
            </div>
            <div
              style={{
                display: 'flex',
                fontSize: 40,
                fontWeight: 'bold',
                color: '#1f2937', // text-gray-800
              }}
            >
              Total Value: ${value}
            </div>
          </div>
          <div
            style={{
              position: 'absolute',
              bottom: 40,
              fontSize: 24,
              color: '#166534',
              fontWeight: 'bold',
            }}
          >
            agri-fi.io
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
      }
    );
  } catch (e: any) {
    console.log(`${e.message}`);
    return new Response(`Failed to generate the image`, {
      status: 500,
    });
  }
}
