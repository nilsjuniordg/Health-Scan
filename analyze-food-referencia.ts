import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');

if (!lovableApiKey) {
  console.error('LOVABLE_API_KEY is not configured');
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageBase64 } = await req.json();

    if (!imageBase64) {
      console.error('No image provided in request');
      return new Response(
        JSON.stringify({ error: 'Imagem não foi enviada. Por favor, selecione uma foto.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!lovableApiKey) {
      console.error('LOVABLE_API_KEY is not configured');
      return new Response(
        JSON.stringify({ error: 'Serviço de IA não configurado. Entre em contato com o suporte.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Starting food image analysis with Lovable AI (Gemini 2.5 Flash)...');

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: `Você é um nutricionista especialista em análise de alimentos brasileiros. Analise a imagem do prato e retorne um JSON com a seguinte estrutura:
{
  "items": [
    {
      "id": "1",
      "label": "nome do alimento em português",
      "confidence": número entre 0 e 1,
      "portionGrams": gramas estimadas,
      "kcal": calorias totais deste item,
      "macros": {
        "carbs": carboidratos em gramas,
        "protein": proteínas em gramas,
        "fat": gorduras em gramas
      }
    }
  ]
}

Regras importantes:
- Identifique TODOS os alimentos visíveis no prato
- Use nomes em português brasileiro
- Seja preciso nas estimativas de porção
- Use a base TACO (Tabela Brasileira de Composição de Alimentos) para valores nutricionais
- Confidence deve refletir sua certeza na identificação (0.0 a 1.0)
- Se não tiver certeza do alimento, use confidence baixo (<0.6)
- Retorne APENAS o JSON, sem texto adicional`
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Por favor, analise esta imagem de comida e retorne as informações nutricionais de cada item identificado.'
              },
              {
                type: 'image_url',
                image_url: {
                  url: imageBase64
                }
              }
            ]
          }
        ],
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Lovable AI API error:', response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Limite de requisições excedido. Aguarde um momento e tente novamente.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: 'Créditos insuficientes. Por favor, adicione créditos ao seu workspace Lovable.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 401) {
        return new Response(
          JSON.stringify({ error: 'Erro de autenticação com serviço de IA. Entre em contato com o suporte.' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: 'Falha ao analisar imagem. Tente novamente.', details: errorText }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    console.log('Lovable AI response received successfully');

    if (!data.choices || !data.choices[0] || !data.choices[0].message || !data.choices[0].message.content) {
      console.error('Invalid AI response structure:', JSON.stringify(data));
      return new Response(
        JSON.stringify({ error: 'Resposta inválida da IA. Tente novamente.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const content = data.choices[0].message.content;
    console.log('AI response content:', content);
    
    // Parse the JSON response
    let parsedContent;
    try {
      // Remove markdown code blocks if present
      const cleanContent = content.replace(/```json\n?|\n?```/g, '').trim();
      parsedContent = JSON.parse(cleanContent);
      
      // Validate response structure
      if (!parsedContent.items || !Array.isArray(parsedContent.items)) {
        throw new Error('Response missing items array');
      }
      
      console.log(`Successfully parsed ${parsedContent.items.length} food items`);
    } catch (e) {
      console.error('Failed to parse AI response:', e);
      console.error('Raw content:', content);
      return new Response(
        JSON.stringify({ error: 'Não foi possível processar a resposta da análise. Tente com outra foto.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Calculate totals
    const total = parsedContent.items.reduce(
      (acc: any, item: any) => ({
        kcal: acc.kcal + (item.kcal || 0),
        macros: {
          carbs: acc.macros.carbs + (item.macros?.carbs || 0),
          protein: acc.macros.protein + (item.macros?.protein || 0),
          fat: acc.macros.fat + (item.macros?.fat || 0)
        }
      }),
      { kcal: 0, macros: { carbs: 0, protein: 0, fat: 0 } }
    );

    console.log('Analysis complete. Total calories:', total.kcal);

    return new Response(
      JSON.stringify({
        items: parsedContent.items,
        total,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in analyze-food function:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    return new Response(
      JSON.stringify({ 
        error: 'Erro ao processar imagem. Por favor, tente novamente.',
        details: error instanceof Error ? error.message : 'Erro desconhecido'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
